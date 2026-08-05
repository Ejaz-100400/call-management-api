import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const CALL_PROCESSING_QUEUE = 'call-processing';

export type CallProcessingJob =
  | { type: 'full_reprocess'; callId: string; recordingUrl?: string }
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
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    });
  }

  async onModuleDestroy() {
    await this.callProcessingQueue.close();
    await this.connection.quit();
  }
}
