import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { QueryWhatsAppConversationsDto } from './dto/query-whatsapp-conversations.dto';
import { WhatsAppMessagesService } from './whatsapp-messages.service';

@Controller('whatsapp')
export class WhatsAppMessagesController {
  constructor(private readonly service: WhatsAppMessagesService) {}

  @Get('conversations')
  findAllConversations(@Query() query: QueryWhatsAppConversationsDto) {
    return this.service.findAllConversations(query);
  }

  @Get('conversations/:id/messages')
  findMessages(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findMessages(id);
  }
}
