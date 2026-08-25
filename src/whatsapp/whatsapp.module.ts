import { Module } from '@nestjs/common';
import { BusinessNumbersModule } from '../business-numbers/business-numbers.module';
import { WhatsappWebhooksController } from './whatsapp-webhooks.controller';
import { WhatsappWebhooksService } from './whatsapp-webhooks.service';

@Module({
  imports: [BusinessNumbersModule],
  controllers: [WhatsappWebhooksController],
  providers: [WhatsappWebhooksService],
})
export class WhatsappModule {}
