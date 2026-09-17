import { Injectable, Logger } from '@nestjs/common';
import { BusinessCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessNumbersService } from '../business-numbers/business-numbers.service';
import { extractWhatsAppProducts } from '../worker/providers/ai.provider';
import { linkWhatsAppProducts } from '../common/product-matching.util';
import { QueryWhatsAppConversationsDto } from './dto/query-whatsapp-conversations.dto';

// How many of the most recent text messages get sent to Claude for
// re-classification -- a WhatsApp thread can run long, and everything
// useful for "what product is this about" is almost always recent; capping
// this keeps every new-message classification cheap and fast regardless of
// how old/long the conversation has grown.
const CLASSIFY_MESSAGE_WINDOW = 30;

export interface IncomingWhatsAppMessage {
  externalMessageId: string;
  fromPhoneNumber: string;
  toPhoneNumberId: string | undefined;
  timestamp: Date;
  messageType: string;
  body: string | null;
}

@Injectable()
export class WhatsAppMessagesService {
  private readonly logger = new Logger(WhatsAppMessagesService.name);

  constructor(
    private prisma: PrismaService,
    private businessNumbers: BusinessNumbersService,
  ) {}

  private findOrCreateCustomer(phoneNumber: string) {
    return this.prisma.customer.upsert({
      where: { phoneNumber },
      create: { phoneNumber },
      update: {},
    });
  }

  private async findOrCreateConversation(customerId: string, businessCategory: BusinessCategory, timestamp: Date) {
    const existing = await this.prisma.whatsAppConversation.findUnique({ where: { customerId } });
    if (existing) return existing;
    return this.prisma.whatsAppConversation.create({
      data: { customerId, businessCategory, lastMessageAt: timestamp },
    });
  }

  /**
   * Called by the webhook handler for every inbound WhatsApp text/media
   * message. Idempotent on externalMessageId (Meta redelivers on anything
   * but a fast 200) -- always fast, DB-only; classification is triggered
   * fire-and-forget afterward (same reasoning as the phone-call webhook's
   * notifyTeam) so a slow/failed Claude call never holds up the webhook
   * response or risks Meta retrying and double-recording the message.
   */
  async recordIncomingMessage(msg: IncomingWhatsAppMessage): Promise<void> {
    const existing = await this.prisma.whatsAppMessage.findUnique({ where: { externalMessageId: msg.externalMessageId } });
    if (existing) return;

    const customer = await this.findOrCreateCustomer(msg.fromPhoneNumber);
    const businessCategory = await this.businessNumbers.resolveCategoryByWhatsAppId(msg.toPhoneNumberId);
    const conversation = await this.findOrCreateConversation(customer.id, businessCategory, msg.timestamp);

    await this.prisma.whatsAppMessage.create({
      data: {
        conversationId: conversation.id,
        externalMessageId: msg.externalMessageId,
        direction: 'inbound', // this webhook only ever carries customer -> business messages
        messageType: msg.messageType,
        body: msg.body,
        timestamp: msg.timestamp,
      },
    });

    const preview = msg.body?.trim() ? msg.body.trim().slice(0, 160) : `[${msg.messageType}]`;
    await this.prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: msg.timestamp,
        lastMessagePreview: preview,
        lastMessageDirection: 'inbound',
        businessCategory,
      },
    });

    this.classifyConversation(conversation.id).catch((err) =>
      this.logger.warn(`WhatsApp product classification failed for conversation ${conversation.id}: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  /** Re-runs product classification over the conversation's recent text messages and replaces its product links. */
  async classifyConversation(conversationId: string): Promise<void> {
    const conversation = await this.prisma.whatsAppConversation.findUnique({ where: { id: conversationId } });
    if (!conversation) return;

    const recentMessages = await this.prisma.whatsAppMessage.findMany({
      where: { conversationId, messageType: 'text', body: { not: null } },
      orderBy: { timestamp: 'desc' },
      take: CLASSIFY_MESSAGE_WINDOW,
      select: { direction: true, body: true },
    });
    if (recentMessages.length === 0) return;

    const productsDiscussed = await extractWhatsAppProducts(
      recentMessages.reverse().map((m) => ({ direction: m.direction, body: m.body! })),
    );

    await linkWhatsAppProducts(this.prisma, conversationId, conversation.businessCategory, productsDiscussed);
    await this.prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: { extractedAt: new Date(), extractedByModel: 'claude-sonnet-5' },
    });
  }

  /** List view -- one row per customer, newest conversation first, with its classified products for the color-coded list. */
  async findAllConversations(query: QueryWhatsAppConversationsDto) {
    const rows = await this.prisma.whatsAppConversation.findMany({
      where: {
        ...(query.category?.length && { businessCategory: { in: query.category } }),
        ...(query.productId?.length && { products: { some: { productId: { in: query.productId } } } }),
        ...(query.search && {
          customer: {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { phoneNumber: { contains: query.search } },
            ],
          },
        }),
      },
      include: {
        customer: { select: { id: true, name: true, phoneNumber: true } },
        products: { include: { product: { select: { id: true, name: true, category: true } } } },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      customer: r.customer,
      businessCategory: r.businessCategory,
      lastMessageAt: r.lastMessageAt,
      lastMessagePreview: r.lastMessagePreview,
      lastMessageDirection: r.lastMessageDirection,
      products: r.products.map((p) => p.product),
    }));
  }

  /** Full message thread for one conversation, oldest first (how a chat actually reads). */
  async findMessages(conversationId: string) {
    return this.prisma.whatsAppMessage.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'asc' },
    });
  }
}
