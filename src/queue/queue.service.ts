import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const CALL_PROCESSING_QUEUE = 'call-processing';

export type CallProcessingJob =
  // recordingUrl is used directly when already known; callSid is used when
  // the provider (Exotel) only gives us a call identifier up front and the
  // worker has to look up the recording URL itself once it's ready.
  | { type: 'full_reprocess'; callId: string; recordingUrl?: string; callSid?: string }
  | { type: 'regenerate_summary'; callId: string };

/**
 * Producer side of the queue -- used by WebhooksService (on a new call) and
 * CallsService (on manual reprocess/regenerate-summary requests). The actual
 * work happens in src/worker, a separate process that consumes this queue.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  // BullMQ's Queue#add() internally awaits the connection reaching 'ready'
  // before running -- with ioredis's default retryStrategy (retry forever
  // with backoff), that means a call to enqueueCallProcessing() hangs
  // indefinitely if Redis is unreachable, rather than failing the HTTP
  // request. Bounding retryStrategy makes the connection give up and emit
  // an error after a few seconds instead of retrying forever; disabling the
  // offline queue makes any command issued in the meantime fail fast too.
  private readonly connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
  });

  readonly callProcessingQueue = new Queue<CallProcessingJob>(CALL_PROCESSING_QUEUE, {
    connection: this.connection,
  });

  enqueueCallProcessing(job: CallProcessingJob) {
    return this.callProcessingQueue.add(job.type, job, {
      // Exotel's recording isn't always ready the instant a call ends, and a
      // webhook that fires early (e.g. before the call connects) needs to
      // wait for the call to actually finish before a recording exists at
      // all -- 3 attempts over ~15s wasn't enough buffer for either case.
      // 6 attempts with exponential backoff spans ~5 minutes before giving
      // up for good.
      attempts: 6,
      backoff: { type: 'exponential', delay: 10000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    });
  }

  async onModuleDestroy() {
    await this.callProcessingQueue.close();
    await this.connection.quit();
  }
}
