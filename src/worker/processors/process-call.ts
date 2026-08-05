import { PrismaClient, type BusinessCategory } from '@prisma/client';
import type { CallProcessingJob } from '../../queue/queue.service';
import { extractCallInfo } from '../providers/ai.provider';
import { fetchFromProviderUrl, fetchFromStorage, uploadRecording } from '../providers/storage.provider';
import { transcribeAudio } from '../providers/stt.provider';

// The worker runs as a separate process from the NestJS app, so it uses its
// own plain PrismaClient rather than the app's Nest-managed PrismaService.
const prisma = new PrismaClient();

export async function processCallJob(job: CallProcessingJob): Promise<void> {
  if (job.type === 'regenerate_summary') {
    return regenerateSummary(job.callId);
  }
  return fullReprocess(job.callId, job.recordingUrl);
}

async function fullReprocess(callId: string, recordingUrl?: string) {
  const call = await prisma.call.findUniqueOrThrow({ where: { id: callId } });

  try {
    await prisma.call.update({ where: { id: callId }, data: { status: 'processing' } });

    let audioBuffer: Buffer;
    let storageKey = call.recordingStorageKey;

    if (recordingUrl) {
      // Fresh call from the webhook: fetch from the provider's (likely
      // temporary) URL, then move it into permanent object storage.
      audioBuffer = await fetchFromProviderUrl(recordingUrl);
      storageKey = await uploadRecording(callId, audioBuffer);
    } else if (call.recordingStorageKey) {
      // Manual reprocess: reuse what's already in object storage.
      audioBuffer = await fetchFromStorage(call.recordingStorageKey);
    } else {
      throw new Error('No recording URL or existing storage key available for this call');
    }

    const transcription = await transcribeAudio(audioBuffer);

    await prisma.transcript.upsert({
      where: { callId },
      create: {
        callId,
        rawText: transcription.rawText,
        language: transcription.language,
        provider: 'deepgram-nova-3',
        diarized: transcription.diarized as object,
      },
      update: {
        rawText: transcription.rawText,
        language: transcription.language,
        diarized: transcription.diarized as object,
      },
    });

    const extraction = await extractCallInfo(transcription.rawText, {
      businessCategory: call.businessCategory,
      callDate: call.callDate,
    });

    await prisma.callExtraction.upsert({
      where: { callId },
      create: {
        callId,
        customerName: extraction.customerName,
        businessCategory: call.businessCategory,
        carMake: extraction.carMake,
        carModel: extraction.carModel,
        carVariant: extraction.carVariant,
        productsDiscussed: extraction.productsDiscussed,
        customerRequirements: extraction.customerRequirements,
        budget: extraction.budget,
        followUpRequired: extraction.followUpRequired,
        followUpDate: extraction.followUpDate ? new Date(extraction.followUpDate) : null,
        summary: extraction.summary,
        sentiment: extraction.sentiment,
        extractedByModel: 'claude-sonnet-5',
        extractedAt: new Date(),
      },
      update: {
        customerName: extraction.customerName,
        carMake: extraction.carMake,
        carModel: extraction.carModel,
        carVariant: extraction.carVariant,
        productsDiscussed: extraction.productsDiscussed,
        customerRequirements: extraction.customerRequirements,
        budget: extraction.budget,
        followUpRequired: extraction.followUpRequired,
        followUpDate: extraction.followUpDate ? new Date(extraction.followUpDate) : null,
        summary: extraction.summary,
        sentiment: extraction.sentiment,
        extractedByModel: 'claude-sonnet-5',
        extractedAt: new Date(),
        editedBy: null,
        editedAt: null,
      },
    });

    await backfillCustomerName(call.customerId, extraction.customerName);

    if (extraction.followUpRequired && extraction.followUpDate) {
      await prisma.followUp.create({
        data: {
          callId,
          dueDate: new Date(extraction.followUpDate),
          assignedTo: call.employeeId,
        },
      });
    }

    await linkDiscussedProducts(callId, call.businessCategory, extraction.productsDiscussed);

    await prisma.call.update({
      where: { id: callId },
      data: { status: 'completed', recordingStorageKey: storageKey, failureReason: null },
    });
  } catch (err) {
    await prisma.call.update({
      where: { id: callId },
      data: { status: 'failed', failureReason: (err as Error).message },
    });
    throw err; // rethrow so BullMQ's retry/backoff applies
  }
}

async function regenerateSummary(callId: string) {
  const transcript = await prisma.transcript.findUniqueOrThrow({ where: { callId } });
  const call = await prisma.call.findUniqueOrThrow({ where: { id: callId } });

  const extraction = await extractCallInfo(transcript.rawText, {
    businessCategory: call.businessCategory,
    callDate: call.callDate,
  });

  await prisma.callExtraction.update({
    where: { callId },
    data: {
      summary: extraction.summary,
      sentiment: extraction.sentiment,
      extractedAt: new Date(),
    },
  });
}

/**
 * The Customer link itself comes from the webhook's caller-ID field
 * (webhooks.service.ts) -- the AI can't reliably identify a caller's own
 * phone number from a transcript. What it CAN pick up is the caller stating
 * their name, so once a customer is linked but still nameless, backfill it
 * from the extraction rather than leaving the directory full of blanks.
 */
async function backfillCustomerName(customerId: string | null, customerName: string | null | undefined) {
  if (!customerId || !customerName) return;
  await prisma.customer.updateMany({
    where: { id: customerId, name: null },
    data: { name: customerName },
  });
}

/**
 * The AI extracts products "in the customer's or agent's own words" (see
 * ai.provider.ts), so this is free text like "windshield crack repair" or
 * "underglow lighting" rather than a clean match against the catalog. Uses
 * the same pg_trgm fuzzy-similarity approach as the customer-duplicate
 * detection in customers.service.ts (word order and exact phrasing don't
 * have to match), scoped to the call's business category to cut down on
 * false positives, so reports like "top products" have real data instead
 * of everyone's phrasing staying siloed in the raw JSONB field forever.
 * Best-effort: an unmatched phrase is just skipped, not an error. Threshold
 * picked empirically -- 0.25+ cleanly separated real matches (0.29-1.0)
 * from noise (~0.1 for genuinely unrelated phrases) against this catalog.
 */
const PRODUCT_MATCH_THRESHOLD = 0.25;

async function linkDiscussedProducts(
  callId: string,
  businessCategory: BusinessCategory,
  productsDiscussed: string[],
) {
  // Clear any existing links first -- this runs on reprocess too, and
  // call_products has no natural way to "upsert" a set membership.
  await prisma.callProduct.deleteMany({ where: { callId } });

  const matchedProductIds = new Set<string>();
  for (const discussed of productsDiscussed) {
    if (!discussed.trim()) continue;

    const [best] = await prisma.$queryRaw<Array<{ id: string; similarity: number }>>`
      SELECT id, similarity(name, ${discussed}) AS similarity
      FROM products
      WHERE category = ${businessCategory}::business_category AND active = true
      ORDER BY similarity DESC
      LIMIT 1;
    `;
    if (best && best.similarity >= PRODUCT_MATCH_THRESHOLD) matchedProductIds.add(best.id);
  }

  if (matchedProductIds.size === 0) return;

  await prisma.callProduct.createMany({
    data: Array.from(matchedProductIds).map((productId) => ({ callId, productId })),
    skipDuplicates: true,
  });
}
