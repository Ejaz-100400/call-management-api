import { PrismaClient } from '@prisma/client';
import type { CallProcessingJob } from '../../queue/queue.service';
import { linkDiscussedProducts } from '../../common/product-matching.util';
import { defaultFollowUpDueDate, withFollowUpConsistency } from '../../follow-ups/follow-up.util';
import { extractCallInfo } from '../providers/ai.provider';
import { fetchExotelCallDetails } from '../providers/exotel.provider';
import { fetchFromProviderUrl, fetchFromStorage, uploadRecording } from '../providers/storage.provider';
import { transcribeAudio } from '../providers/stt.provider';

// The worker runs as a separate process from the NestJS app, so it uses its
// own plain PrismaClient rather than the app's Nest-managed PrismaService.
const prisma = new PrismaClient();

export async function processCallJob(job: CallProcessingJob): Promise<void> {
  if (job.type === 'regenerate_summary') {
    return regenerateSummary(job.callId);
  }
  return fullReprocess(job.callId, job.recordingUrl, job.callSid);
}

async function fullReprocess(callId: string, recordingUrl?: string, callSid?: string) {
  const call = await prisma.call.findUniqueOrThrow({ where: { id: callId } });

  try {
    await prisma.call.update({ where: { id: callId }, data: { status: 'processing' } });

    // Exotel's webhook only gives us a CallSid, not the recording -- look up
    // the real call details (recording URL, duration, start time) now. The
    // recording isn't always ready the instant the call ends, so a missing
    // RecordingUrl here throws (rather than silently proceeding with no
    // audio); BullMQ's existing retry/backoff on this job picks it up again
    // a few seconds later instead of this needing its own polling loop.
    if (!recordingUrl && callSid) {
      const details = await fetchExotelCallDetails(callSid);
      if (!details.recordingUrl) {
        throw new Error(`Exotel call ${callSid} has no recording URL yet (status: ${details.status})`);
      }
      recordingUrl = details.recordingUrl;
      await prisma.call.update({
        where: { id: callId },
        data: {
          durationSeconds: details.durationSeconds,
          ...(details.startTime && { callDate: details.startTime }),
        },
      });
    }

    let audioBuffer: Buffer;
    let storageKey = call.recordingStorageKey;

    if (recordingUrl) {
      // Fresh call from the webhook: fetch from the provider's (likely
      // temporary) URL, then move it into permanent object storage.
      audioBuffer = await fetchFromProviderUrl(recordingUrl);
      storageKey = await uploadRecording(callId, audioBuffer);
      // Persist immediately rather than waiting for the whole pipeline to
      // finish -- a later step (transcription, AI extraction) failing would
      // otherwise leave a successfully-stored recording with no DB pointer
      // to it, making it invisible in the UI despite being safely in R2. A
      // retry would also re-fetch/re-upload from Exotel's (temporary) URL
      // every time instead of reusing what's already stored.
      await prisma.call.update({ where: { id: callId }, data: { recordingStorageKey: storageKey } });
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
    // Sentiment and the follow-up flag are independent extraction targets --
    // Claude can say "needs_follow_up" without also setting followUpRequired.
    // A call that reads as needing follow-up should always get a task.
    extraction.followUpRequired = withFollowUpConsistency(extraction.followUpRequired, extraction.sentiment);

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

    if (extraction.followUpRequired) {
      // Callers often say "call me back" without a specific date -- default
      // rather than silently never creating the task.
      const dueDate = extraction.followUpDate ? new Date(extraction.followUpDate) : defaultFollowUpDueDate();
      await prisma.followUp.create({
        data: { callId, dueDate, assignedTo: call.employeeId },
      });
    }

    await linkDiscussedProducts(prisma, callId, call.businessCategory, extraction.productsDiscussed);

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
  const existing = await prisma.callExtraction.findUniqueOrThrow({ where: { callId } });

  const extraction = await extractCallInfo(transcript.rawText, {
    businessCategory: call.businessCategory,
    callDate: call.callDate,
  });
  // This only re-runs summarization, but a fresh sentiment of
  // "needs_follow_up" still needs to flip the flag/create the task -- this
  // path previously left followUpRequired (and the FollowUp row) exactly as
  // they were before the re-summarize, which is how sentiment and the flag
  // drifted apart on existing calls.
  const followUpRequired = withFollowUpConsistency(existing.followUpRequired, extraction.sentiment);

  await prisma.callExtraction.update({
    where: { callId },
    data: {
      summary: extraction.summary,
      sentiment: extraction.sentiment,
      followUpRequired,
      extractedAt: new Date(),
    },
  });

  if (followUpRequired && !existing.followUpRequired) {
    const alreadyHasFollowUp = await prisma.followUp.findFirst({ where: { callId } });
    if (!alreadyHasFollowUp) {
      await prisma.followUp.create({
        data: { callId, dueDate: existing.followUpDate ?? defaultFollowUpDueDate(), assignedTo: call.employeeId },
      });
    }
  }
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
