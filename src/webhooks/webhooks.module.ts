import { Module } from '@nestjs/common';
import { BusinessNumbersModule } from '../business-numbers/business-numbers.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { OutboundCallSyncService } from './outbound-call-sync.service';

@Module({
  imports: [BusinessNumbersModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, OutboundCallSyncService],
})
export class WebhooksModule {}
