import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { syncOutboundCalls } from './outbound-call-sync.provider';

/**
 * Exotel doesn't send us a webhook for outbound calls (staff calling a
 * customer back) the way it does for inbound -- there's no push mechanism
 * available for this, so this polls Exotel's own Call list instead.
 *
 * Two passes:
 *  - On startup: a wide 60-day catch-up (covers this account's entire
 *    history -- the Exotel integration itself is only about a week old at
 *    time of writing). syncOutboundCalls is idempotent, so this re-running
 *    on every deploy/restart is harmless and cheap, just a quick no-op
 *    re-check once the backlog is caught up -- not worth the extra state
 *    to track "already ran once" given the modest call volume.
 *  - Every 10 minutes after: a narrow 20-minute window (double the
 *    interval, so a slow tick or a brief gap never loses a call).
 *
 * Both passes are wrapped in try/catch deliberately: a transient Exotel API
 * failure here must never take down the rest of the app, and critically
 * must never prevent NestJS from finishing bootstrap -- an unhandled
 * rejection in OnModuleInit can abort startup entirely, which is exactly
 * the failure mode to avoid here.
 */
@Injectable()
export class OutboundCallSyncService implements OnModuleInit {
  private readonly logger = new Logger(OutboundCallSyncService.name);

  constructor(
    private prisma: PrismaService,
    private queue: QueueService,
  ) {}

  async onModuleInit() {
    try {
      const now = new Date();
      const from = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      await syncOutboundCalls(this.prisma, (job) => this.queue.enqueueCallProcessing(job), from, now);
    } catch (err) {
      this.logger.error(`Outbound call startup catch-up failed: ${(err as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async syncRecent() {
    try {
      const now = new Date();
      const from = new Date(now.getTime() - 20 * 60 * 1000);
      await syncOutboundCalls(this.prisma, (job) => this.queue.enqueueCallProcessing(job), from, now);
    } catch (err) {
      this.logger.error(`Outbound call sync failed: ${(err as Error).message}`);
    }
  }
}
