import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  // Public: the telephony provider calls this directly, there's no logged-in
  // user or Supabase JWT involved. Before going live, add signature/secret
  // verification here if your provider supports it, so random requests to
  // this URL can't fabricate call records.
  @Public()
  @Post('call-completed')
  handleCallCompleted(@Body() payload: Record<string, unknown>) {
    return this.webhooksService.handleCallCompleted(payload);
  }
}
