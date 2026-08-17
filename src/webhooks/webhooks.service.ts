import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { parseIstTimestamp } from '../common/timezone.util';
import { BusinessNumbersService } from '../business-numbers/business-numbers.service';
import { sendCallNotificationSms } from '../notifications/sms.provider';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private prisma: PrismaService,
    private queue: QueueService,
    private businessNumbers: BusinessNumbersService,
  ) {}

  async handleCallCompleted(payload: Record<string, unknown>) {
    // Exotel's docs describe CallSid/CallFrom/CallTo/Direction/CurrentTime/
    // DialWhomNumber -- but a real live payload also carried From/To
    // alongside CallFrom/CallTo, and critically CallTo did NOT match the
    // actual ExoPhone/Virtual Number for that call while To did. Preferring
    // To/From (falling back to CallTo/CallFrom if a differently-configured
    // flow only sends the documented set) is what actually matches the
    // dashboard's own "Virtual Number" field. None of this includes the
    // recording URL, duration, or final status -- those only come from a
    // separate Call Details lookup made after the fact using CallSid, which
    // the worker does once it picks up the job (see exotel.provider.ts and
    // process-call.ts) -- the recording usually isn't finalized the instant
    // the call ends anyway.
    this.logger.log(`Received call-completed webhook: ${JSON.stringify(payload)}`);

    const callSid = payload.CallSid as string | undefined;
    const callerPhone = ((payload.From ?? payload.CallFrom) as string | undefined)?.trim();
    const businessNumber = (payload.To ?? payload.CallTo) as string | undefined;
    const currentTime = (payload.CurrentTime ?? payload.Created) as string | undefined;

    // A Connect applet's own dial-out to a co-worker/group member fires a
    // second call-completed webhook where CallFrom is the ExoPhone itself,
    // not the real customer -- skip those so one customer call doesn't
    // produce two Call rows.
    if (callerPhone && (await this.businessNumbers.isOwnNumber(callerPhone))) {
      this.logger.log(`Skipping internal leg webhook (caller ${callerPhone} is one of our own numbers), CallSid=${callSid}`);
      return { received: true, skipped: true };
    }

    const customer = callerPhone ? await this.findOrCreateCustomer(callerPhone) : undefined;

    const call = await this.prisma.call.create({
      data: {
        externalCallId: callSid ?? undefined,
        businessCategory: await this.businessNumbers.resolveCategory(businessNumber),
        customerId: customer?.id,
        callDate: (currentTime && parseIstTimestamp(currentTime)) ?? new Date(),
        durationSeconds: 0, // corrected once the worker fetches real call details
        recordingStorageKey: null, // filled in once the worker uploads it to object storage
        status: 'pending',
      },
    });

    await this.queue.enqueueCallProcessing({
      type: 'full_reprocess',
      callId: call.id,
      callSid,
    });

    // Fire-and-forget: the customer's real number never shows up on a
    // technician's phone (Exotel/carrier forwarding means the caller ID they
    // see is always the ExoPhone), so the team gets it by SMS instead. Not
    // awaited -- a slow/failed SMS send should never hold up the webhook
    // response or the actual call-processing pipeline.
    if (callerPhone) {
      this.notifyTeam(callerPhone, payload).catch((err) =>
        this.logger.warn(`Call notification SMS failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    }

    return { received: true, callId: call.id };
  }

  private async notifyTeam(callerPhone: string, payload: Record<string, unknown>) {
    const employees = await this.prisma.employee.findMany({ where: { active: true }, select: { phone: true } });
    const recipients = employees.map((e) => e.phone).filter((p): p is string => Boolean(p));
    if (recipients.length === 0) return;

    const dialCallStatus = (payload.DialCallStatus as string | undefined)?.toLowerCase();
    const durationSeconds = Number(payload.DialCallDuration ?? 0) || 0;

    await sendCallNotificationSms(recipients, {
      customerPhone: callerPhone,
      durationSeconds,
      status: dialCallStatus === 'completed' ? 'completed' : 'missed',
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
