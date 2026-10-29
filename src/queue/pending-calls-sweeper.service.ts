import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from './queue.service';

// A call is normally picked up by the worker within seconds, and a job that
// keeps failing exhausts its retries (~5 min) and marks the call failed --
// so a call still "pending" after 10 minutes almost certainly never got a
// job at all (e.g. Redis was unreachable at the moment its webhook arrived).
const STUCK_AFTER_MS = 10 * 60_000;
// Keeps one run small if a long outage left a big backlog -- the rest are
// picked up by the next run five minutes later.
const MAX_PER_RUN = 25;
// Recovery attempts for the same call within this window share a job id, so
// repeated runs can't stack up duplicate jobs for one call -- but a call
// that gets stuck again later (e.g. after a manual Reprocess) isn't blocked
// by an old finished job still sitting in the queue's history.
const DEDUPE_WINDOW_MS = 30 * 60_000;

/**
 * Safety net for calls that were saved but never queued. The webhook creates
 * the Call row first and queues it second; if the queue step fails the row
 * stays "pending" forever with nothing to process it. This puts those back on
 * the queue, so an outage heals itself instead of needing someone to notice
 * the stuck calls and click Reprocess on each.
 */
@Injectable()
export class PendingCallsSweeperService {
  private readonly logger = new Logger(PendingCallsSweeperService.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private queue: QueueService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let requeued = 0;
    try {
      const stuck = await this.prisma.call.findMany({
        where: { status: 'pending', createdAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } },
        orderBy: { createdAt: 'asc' },
        take: MAX_PER_RUN,
        select: { id: true, externalCallId: true },
      });
      if (stuck.length === 0) return 0;

      const bucket = Math.floor(Date.now() / DEDUPE_WINDOW_MS);
      for (const call of stuck) {
        await this.queue.enqueueCallProcessing(
          { type: 'full_reprocess', callId: call.id, callSid: call.externalCallId ?? undefined },
          { jobId: `recover-${call.id}-${bucket}` },
        );
        requeued++;
      }
      this.logger.log(`Re-queued ${requeued} call(s) that were stuck pending.`);
    } catch (err) {
      // Redis still down, most likely -- don't spam, the next run retries.
      this.logger.warn(`Pending-call sweep stopped after ${requeued} re-queued: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
    return requeued;
  }
}
