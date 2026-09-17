import { Module } from '@nestjs/common';
import { BusinessNumbersModule } from '../business-numbers/business-numbers.module';
import { WhatsappWebhooksController } from './whatsapp-webhooks.controller';
import { WhatsappWebhooksService } from './whatsapp-webhooks.service';
import { WhatsAppMessagesController } from './whatsapp-messages.controller';
import { WhatsAppMessagesService } from './whatsapp-messages.service';

@Module({
  imports: [BusinessNumbersModule],
  controllers: [WhatsappWebhooksController, WhatsAppMessagesController],
  providers: [WhatsappWebhooksService, WhatsAppMessagesService],
})
export class WhatsappModule {}
