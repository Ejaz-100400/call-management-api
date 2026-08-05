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
    // NOTE: the field names below (CallSid, To, StartTime, Duration, RecordingUrl)
    // are placeholders. Exotel/Ozonetel/Knowlarity/Twilio each use a different
    // webhook payload shape -- swap these for whatever your provider actually sends.
    this.logger.log(`Received call-completed webhook: ${JSON.stringify(payload)}`);

    const call = await this.prisma.call.create({
      data: {
        externalCallId: (payload.CallSid as string) ?? undefined,
        businessCategory: this.resolveCategory(payload.To as string),
        callDate: payload.StartTime ? new Date(payload.StartTime as string) : new Date(),
        durationSeconds: Number(payload.Duration ?? 0),
        recordingStorageKey: null, // filled in once the worker uploads it to object storage
        status: 'pending',
      },
    });

    // The provider's RecordingUrl is typically temporary -- pass it straight
    // into the job rather than storing it, so the worker fetches it once and
    // moves it into permanent object storage.
    await this.queue.enqueueCallProcessing({
      type: 'full_reprocess',
      callId: call.id,
      recordingUrl: payload.RecordingUrl as string | undefined,
    });

    return { received: true, callId: call.id };
  }

  private resolveCategory(businessNumber: string): BusinessCategory {
    // With exactly two fixed lines, an env-configured mapping is enough.
    // If you ever add a third number, promote this into a business_numbers table.
    const carGlassesNumber = process.env.CAR_GLASSES_NUMBER;
    return businessNumber === carGlassesNumber ? 'car_glasses' : 'car_modifications';
  }
}
