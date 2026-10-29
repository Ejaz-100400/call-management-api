import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const CALL_PROCESSING_QUEUE = 'call-processing';

export type CallProcessingJob =
  // recordingUrl is used directly when already known; callSid is used when
  // the provider (Exotel) only gives us a call identifier up front and the
  // worker has to look up the recording URL itself once it's ready.
  | { type: 'full_reprocess'; callId: string; recordingUrl?: string; callSid?: string }
  | { type: 'regenerate_summary'; callId: string };

export interface EnqueueOptions {
  /** BullMQ ignores an add() whose jobId already exists -- used to keep a repeated recovery attempt from piling up duplicates. */
  jobId?: string;
}

// How long a caller waits to get a job onto the queue before giving up on
// this attempt. Bounded on purpose: the connection below retries forever,
// and BullMQ's add() waits for it to be ready, so without a limit an
// unreachable Redis would hang the webhook request instead of failing it.
const ENQUEUE_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  // If the timeout wins, the original add() may still settle later -- make
  // sure that late rejection isn't reported as unhandled.
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Producer side of the queue -- used by WebhooksService (on a new call) and
 * CallsService (on manual reprocess/regenerate-summary requests). The actual
 * work happens in src/worker, a separate process that consumes this queue.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private lastErrorLogAt = 0;

  // Retries forever, with a short capped backoff. This used to give up after
  // 5 attempts (to stop add() hanging when Redis is down) -- but giving up is
  // permanent: after one brief Redis restart the connection stayed dead for
  // the life of the process, and every incoming call was saved but never
  // queued ("ECONNREFUSED" in the API logs while Redis itself was healthy)
  // until the API was restarted. add() is bounded by ENQUEUE_TIMEOUT_MS
  // instead, so an outage fails fast per call but heals on its own.
  // enableOfflineQueue stays off so commands issued while disconnected fail
  // immediately rather than piling up in memory.
  private readonly connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });

  readonly callProcessingQueue = new Queue<CallProcessingJob>(CALL_PROCESSING_QUEUE, {
    connection: this.connection,
  });

  constructor() {
    // Without listeners, a connection error is an unhandled 'error' event.
    // Throttled: while Redis is down this fires on every retry.
    const logError = (err: Error) => {
      const now = Date.now();
      if (now - this.lastErrorLogAt < 30_000) return;
      this.lastErrorLogAt = now;
      this.logger.warn(`Redis connection problem (still retrying): ${err.message}`);
    };
    this.connection.on('error', logError);
    this.callProcessingQueue.on('error', logError);
  }

  enqueueCallProcessing(job: CallProcessingJob, opts: EnqueueOptions = {}) {
    const added = this.callProcessingQueue.add(job.type, job, {
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
      ...(opts.jobId && { jobId: opts.jobId }),
    });
    return withTimeout(added, ENQUEUE_TIMEOUT_MS, 'Timed out queueing the call for processing -- Redis is unreachable');
  }

  async onModuleDestroy() {
    await this.callProcessingQueue.close().catch(() => {});
    // quit() throws if the connection is already down; disconnect() is the
    // safe fallback so shutdown never errors just because Redis is away.
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}
