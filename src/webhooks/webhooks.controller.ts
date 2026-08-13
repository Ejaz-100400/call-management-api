import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  // Public: the telephony provider calls this directly, there's no logged-in
  // user or Supabase JWT involved. Before going live, add signature/secret
  // verification here if your provider supports it, so random requests to
  // this URL can't fabricate call records.
  //
  // Both GET and POST are accepted -- Exotel's Passthru applet can be
  // configured either way, and a live test call confirmed it was actually
  // hitting this URL as a GET with the payload as query params (visible in
  // Exotel's own call log as "...call-completed?CallSid=...&CallFrom=..."),
  // which a POST-only route silently 404s/405s -- Exotel logged "an HTTP
  // call was made" while nothing ever reached handleCallCompleted at all.
  @Public()
  @Get('call-completed')
  handleCallCompletedGet(@Query() payload: Record<string, unknown>) {
    return this.webhooksService.handleCallCompleted(payload);
  }

  @Public()
  @Post('call-completed')
  handleCallCompletedPost(@Body() payload: Record<string, unknown>) {
    return this.webhooksService.handleCallCompleted(payload);
  }
}
