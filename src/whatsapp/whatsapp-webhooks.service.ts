import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { BusinessNumbersService } from '../business-numbers/business-numbers.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Meta's WhatsApp Calling webhook is a newer (2025) part of the Cloud API --
 * this shape is our best-effort reading of Meta's documentation, not yet
 * confirmed against a real payload from this account. Every event is logged
 * in full below specifically so the first real test call's actual JSON can
 * be read from the logs and this parsing adjusted if any field name is off,
 * rather than guessing twice. Follows the same envelope as WhatsApp message
 * webhooks: entry[].changes[].value.calls[].
 */
interface WhatsAppCallEvent {
  id?: string;
  from?: string;
  to?: string;
  direction?: string;
  event?: string;
  status?: string;
  start_time?: string;
  end_time?: string;
  duration?: number;
  [key: string]: unknown;
}

interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        calls?: WhatsAppCallEvent[];
      };
    }>;
  }>;
}

// Statuses that mean the call never actually connected -- everything else
// (completed, or anything unrecognized with real duration) is treated as
// answered, same "don't assume, check duration" caution used for phone calls.
const NO_CONNECT_STATUSES = new Set(['missed', 'rejected', 'failed', 'no-answer', 'no_answer', 'unanswered']);

@Injectable()
export class WhatsappWebhooksService {
  private readonly logger = new Logger(WhatsappWebhooksService.name);

  constructor(
    private prisma: PrismaService,
    private businessNumbers: BusinessNumbersService,
  ) {}

  /**
   * Meta signs the raw request body with the App Secret (HMAC-SHA256) and
   * sends it as `X-Hub-Signature-256: sha256=<hex>` -- verifying this is
   * what stops a random request to this public URL from fabricating a call
   * record. Requires main.ts's json() middleware to have captured
   * req.rawBody (the exact bytes Meta signed; re-serializing the parsed
   * body would not byte-for-byte match).
   */
  verifySignature(req: Request & { rawBody?: Buffer }): boolean {
    const secret = process.env.WHATSAPP_APP_SECRET;
    const header = req.headers['x-hub-signature-256'];
    if (!secret) {
      this.logger.warn('WHATSAPP_APP_SECRET not set -- rejecting all WhatsApp webhook events until configured.');
      return false;
    }
    if (!req.rawBody || typeof header !== 'string' || !header.startsWith('sha256=')) return false;

    const expected = createHmac('sha256', secret).update(req.rawBody).digest('hex');
    const provided = header.slice('sha256='.length);
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  }

  async handleWebhook(payload: WhatsAppWebhookPayload): Promise<void> {
    this.logger.log(`WhatsApp webhook received: ${JSON.stringify(payload)}`);

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'calls' || !change.value?.calls) continue;
        const phoneNumberId = change.value.metadata?.phone_number_id;
        for (const call of change.value.calls) {
          await this.handleCallEvent(call, phoneNumberId);
        }
      }
    }
  }

  private async handleCallEvent(call: WhatsAppCallEvent, phoneNumberId: string | undefined): Promise<void> {
    // Only act on the terminal event -- an earlier "connect"/"ringing"
    // signal has no duration/final status yet, and with no recording or
    // transcript pipeline to run there's nothing useful to do with it
    // before the call actually finishes.
    const isTerminal = call.event ? ['terminate', 'terminated', 'completed', 'ended'].includes(call.event.toLowerCase()) : Boolean(call.duration != null || call.end_time);
    if (!isTerminal) {
      this.logger.log(`Ignoring non-terminal WhatsApp call event: ${call.event ?? 'unknown'} for call ${call.id}`);
      return;
    }

    const callSid = call.id;
    if (!callSid) {
      this.logger.warn(`WhatsApp call event missing an id, skipping: ${JSON.stringify(call)}`);
      return;
    }

    const existing = await this.prisma.call.findUnique({ where: { externalCallId: callSid } });
    if (existing) return; // already recorded (Meta can redeliver the same event)

    const callerNumber = call.from?.trim();
    const businessCategory = await this.businessNumbers.resolveCategoryByWhatsAppId(phoneNumberId);
    const customer = callerNumber ? await this.findOrCreateCustomer(callerNumber) : undefined;

    const durationSeconds = call.duration ?? 0;
    const statusRaw = call.status?.toLowerCase() ?? '';
    const connected = durationSeconds > 0 && !NO_CONNECT_STATUSES.has(statusRaw);

    const callDate = call.start_time ? new Date(call.start_time) : new Date();

    await this.prisma.call.create({
      data: {
        externalCallId: callSid,
        channel: 'whatsapp',
        direction: call.direction?.toUpperCase() === 'BUSINESS_INITIATED' ? 'outbound' : 'inbound',
        businessCategory,
        customerId: customer?.id,
        callDate,
        durationSeconds,
        recordingStorageKey: null,
        status: connected ? 'completed' : 'failed',
        failureReason: connected ? null : `WhatsApp call ${statusRaw || 'not answered'}`,
      },
    });
  }

  private findOrCreateCustomer(phoneNumber: string) {
    return this.prisma.customer.upsert({
      where: { phoneNumber },
      create: { phoneNumber },
      update: {},
    });
  }
}
