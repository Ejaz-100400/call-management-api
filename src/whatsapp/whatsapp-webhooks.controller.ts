import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { WhatsappWebhooksService } from './whatsapp-webhooks.service';

@Controller('webhooks/whatsapp')
export class WhatsappWebhooksController {
  constructor(private readonly service: WhatsappWebhooksService) {}

  // Meta's one-time verification handshake, sent when you save the Callback
  // URL in the App Dashboard -- must echo hub.challenge back as plain text.
  @Public()
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.status(403).send('Verification failed');
    }
  }

  // Public: Meta calls this directly, no logged-in user involved --
  // verifySignature() below is what stops a random request from
  // fabricating a call record. Always 200s (Meta doesn't need to know if
  // an individual event was rejected/ignored, and a non-200 just triggers
  // pointless retries).
  @Public()
  @Post()
  @HttpCode(200)
  async handleEvent(@Body() payload: Record<string, unknown>, @Req() req: Request) {
    if (!this.service.verifySignature(req)) {
      return { received: false };
    }
    await this.service.handleWebhook(payload);
    return { received: true };
  }
}
