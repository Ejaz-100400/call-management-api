import { PrismaClient } from '@prisma/client';
import type { CallProcessingJob } from '../../queue/queue.service';
import { linkDiscussedProducts } from '../../common/product-matching.util';
import { defaultFollowUpDueDate, withFollowUpConsistency } from '../../follow-ups/follow-up.util';
import { extractCallInfo } from '../providers/ai.provider';
import { describeNoConnectReason, describeStillNoRecordingReason, fetchExotelCallDetails, isTerminalNoConnectStatus } from '../providers/exotel.provider';
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
        if (details.answeredBy === 'human' && details.durationSeconds >= 3 && !(await isVoicemailInterceptRisk(call.employeeId))) {
          // Exotel's own AnsweredBy is the most reliable signal it gives for
          // "did a person actually pick up" -- a real conversation happened
          // here, the recording is just missing (an Exotel-side gap, not a
          // missed call). Marking this "failed" would misrepresent a
          // genuinely handled customer as unreached. No transcript/AI
          // extraction is possible without audio, same as a manually
          // imported historical call.
          await prisma.call.update({
            where: { id: callId },
            data: {
              status: 'completed',
              failureReason: null,
              durationSeconds: details.durationSeconds,
              ...(details.startTime && { callDate: details.startTime }),
            },
          });
          return;
        }
        if (isTerminalNoConnectStatus(details.status)) {
          // This call will never get a recording -- no point burning ~5
          // minutes of BullMQ retries to find that out. Settle it now with
          // a reason staff can actually act on, matching what Exotel's own
          // dashboard shows for the same call (see MissedCalls/CallList).
          await prisma.call.update({
            where: { id: callId },
            data: {
              status: 'failed',
              failureReason: describeNoConnectReason(details.status),
              durationSeconds: details.durationSeconds,
              ...(details.startTime && { callDate: details.startTime }),
            },
          });
          return;
        }
        // Persist the real duration/time even on the path that's about to
        // throw -- otherwise a "Call connected" reason computed from
        // Exotel's actual (non-zero) duration ends up sitting next to a
        // stale "0:00" in the UI once this settles to failed, which reads
        // as a flat contradiction.
        await prisma.call.update({
          where: { id: callId },
          data: { durationSeconds: details.durationSeconds, ...(details.startTime && { callDate: details.startTime }) },
        });
        throw new Error(describeStillNoRecordingReason(details.status, details.durationSeconds));
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

    await fillFromKnownCustomer(call.customerId, extraction);

    await prisma.callExtraction.upsert({
      where: { callId },
      create: {
        callId,
        customerName: extraction.customerName,
        businessCategory: call.businessCategory,
        carMake: extraction.carMake,
        carModel: extraction.carModel,
        carVariant: extraction.carVariant,
        location: extraction.location,
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
        location: extraction.location,
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
    await backfillCustomerVehicleInfo(call.customerId, extraction);

    if (extraction.followUpRequired) {
      // Callers often say "call me back" without a specific date -- default
      // rather than silently never creating the task. Upsert, not create --
      // a retry or manual reprocess re-runs this same block, and a plain
      // create() here previously produced a second FollowUp row for the
      // same call every time that happened. On an existing row, only the
      // due date is refreshed; status/assignedTo/notes (anything staff may
      // have already set) are left untouched.
      const dueDate = extraction.followUpDate ? new Date(extraction.followUpDate) : defaultFollowUpDueDate();
      await prisma.followUp.upsert({
        where: { callId },
        create: { callId, dueDate, assignedTo: call.employeeId },
        update: { dueDate },
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

// Jaheer's iPhone voicemail auto-answers look identical to a real pickup (AnsweredBy: human, real duration), so treat his no-recording calls as genuine misses.
async function isVoicemailInterceptRisk(employeeId: string | null): Promise<boolean> {
  if (!employeeId) return false;
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { name: true } });
  return employee?.name === 'Jaheer Hussain';
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

/**
 * A returning customer's vehicle rarely comes up again in a later call --
 * they call assuming we already know it. Before this call's own extraction
 * is saved, fill in whatever the AI didn't pick up on THIS transcript from
 * the customer's saved profile (a prior call's confirmed details), so the
 * call record itself carries the known vehicle forward rather than showing
 * blank fields the customer never had to repeat.
 */
async function fillFromKnownCustomer(customerId: string | null, extraction: Awaited<ReturnType<typeof extractCallInfo>>) {
  if (!customerId) return;
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { carMake: true, carModel: true, carVariant: true, location: true },
  });
  if (!customer) return;
  extraction.carMake ??= customer.carMake;
  extraction.carModel ??= customer.carModel;
  extraction.carVariant ??= customer.carVariant;
  extraction.location ??= customer.location;
}

/**
 * The reverse direction of fillFromKnownCustomer: once this call's
 * extraction is settled, save any newly-learned vehicle details back to the
 * customer's profile so the NEXT call starts from them too. Only fills gaps
 * (never overwrites an existing saved value) -- an automatic extraction on
 * one call shouldn't silently clobber a detail a staff member already
 * confirmed on a previous one; that only happens through a deliberate edit
 * (see updateExtraction in calls.service.ts).
 */
async function backfillCustomerVehicleInfo(
  customerId: string | null,
  extraction: { carMake: string | null; carModel: string | null; carVariant: string | null; location: string | null },
) {
  if (!customerId) return;
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { carMake: true, carModel: true, carVariant: true, location: true },
  });
  if (!customer) return;

  const data: Record<string, string> = {};
  if (!customer.carMake && extraction.carMake) data.carMake = extraction.carMake;
  if (!customer.carModel && extraction.carModel) data.carModel = extraction.carModel;
  if (!customer.carVariant && extraction.carVariant) data.carVariant = extraction.carVariant;
  if (!customer.location && extraction.location) data.location = extraction.location;
  if (Object.keys(data).length === 0) return;

  await prisma.customer.update({ where: { id: customerId }, data });
}
