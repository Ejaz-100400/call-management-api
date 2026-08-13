import { Injectable, Logger } from '@nestjs/common';
import { BusinessCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private prisma: PrismaService,
    private queue: QueueService,
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
    const customer = callerPhone ? await this.findOrCreateCustomer(callerPhone) : undefined;

    const call = await this.prisma.call.create({
      data: {
        externalCallId: callSid ?? undefined,
        businessCategory: this.resolveCategory(businessNumber),
        customerId: customer?.id,
        callDate: currentTime ? new Date(currentTime) : new Date(),
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

    return { received: true, callId: call.id };
  }

  private findOrCreateCustomer(phoneNumber: string) {
    return this.prisma.customer.upsert({
      where: { phoneNumber },
      create: { phoneNumber },
      update: {},
    });
  }

  private resolveCategory(businessNumber: string | undefined): BusinessCategory {
    // With exactly two fixed lines, an env-configured mapping is enough.
    // If you ever add a third number, promote this into a business_numbers table.
    const carGlassesNumber = process.env.CAR_GLASSES_NUMBER;
    return businessNumber === carGlassesNumber ? 'car_glasses' : 'car_modifications';
  }
}
