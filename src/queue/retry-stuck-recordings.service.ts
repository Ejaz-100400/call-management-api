import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from './queue.service';

/**
 * A call that fails because Exotel hasn't produced a recording yet already
 * gets BullMQ's own retry/backoff (~5 minutes, see enqueueCallProcessing).
 * But during a real provider-side outage, the recording can still be missing
 * hours later -- at that point the job gives up for good and the call sits
 * stuck on status='failed' forever, with staff having to notice and click
 * "Reprocess" on each one by hand once the provider recovers. This sweeps
 * for exactly that stuck state periodically and retries automatically, so a
 * batch of calls affected by an outage self-heals once Exotel's recordings
 * become available again, no manual babysitting required.
 *
 * Bounded to the last 48 hours specifically so this doesn't retry forever on
 * a call that will genuinely never have a recording (nobody answered) --
 * durationSeconds isn't a reliable signal here since it's never updated for
 * calls that hit this failure mode (see process-call.ts).
 */
@Injectable()
export class RetryStuckRecordingsService {
  private readonly logger = new Logger(RetryStuckRecordingsService.name);

  constructor(
    private prisma: PrismaService,
    private queue: QueueService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async retryStuckRecordings() {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const stuck = await this.prisma.call.findMany({
      where: {
        status: 'failed',
        recordingStorageKey: null,
        externalCallId: { not: null },
        callDate: { gte: cutoff },
        failureReason: { contains: 'recording', mode: 'insensitive' },
      },
      select: { id: true, externalCallId: true },
    });

    if (stuck.length === 0) return;

    this.logger.log(`Retrying ${stuck.length} call(s) stuck on a missing recording`);
    for (const call of stuck) {
      await this.queue.enqueueCallProcessing({
        type: 'full_reprocess',
        callId: call.id,
        callSid: call.externalCallId!,
      });
    }
  }
}
