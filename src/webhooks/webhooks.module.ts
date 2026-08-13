import { Module } from '@nestjs/common';
import { BusinessNumbersModule } from '../business-numbers/business-numbers.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [BusinessNumbersModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
