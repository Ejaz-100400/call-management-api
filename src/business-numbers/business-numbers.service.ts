import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BusinessCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBusinessNumberDto } from './dto/create-business-number.dto';
import { UpdateBusinessNumberDto } from './dto/update-business-number.dto';

export interface BusinessNumberView {
  id: string;
  number: string;
  exophoneNumber: string | null;
  whatsappPhoneNumberId: string | null;
  category: BusinessCategory;
  label: string;
}

@Injectable()
export class BusinessNumbersService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<BusinessNumberView[]> {
    const rows = await this.prisma.businessNumber.findMany({ orderBy: { label: 'asc' } });
    return rows.map(this.toView);
  }

  async create(dto: CreateBusinessNumberDto): Promise<BusinessNumberView> {
    const existing = await this.prisma.businessNumber.findUnique({ where: { phoneNumber: dto.phoneNumber } });
    if (existing) throw new ConflictException(`${dto.phoneNumber} is already configured`);
    const row = await this.prisma.businessNumber.create({
      data: {
        phoneNumber: dto.phoneNumber,
        exophoneNumber: dto.exophoneNumber || null,
        whatsappPhoneNumberId: dto.whatsappPhoneNumberId || null,
        businessCategory: dto.category,
        label: dto.label,
      },
    });
    return this.toView(row);
  }

  async update(id: string, dto: UpdateBusinessNumberDto): Promise<BusinessNumberView> {
    const existing = await this.prisma.businessNumber.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Business number ${id} not found`);

    if (dto.phoneNumber && dto.phoneNumber !== existing.phoneNumber) {
      const clash = await this.prisma.businessNumber.findUnique({ where: { phoneNumber: dto.phoneNumber } });
      if (clash) throw new ConflictException(`${dto.phoneNumber} is already configured`);
    }

    const row = await this.prisma.businessNumber.update({
      where: { id },
      data: {
        phoneNumber: dto.phoneNumber,
        exophoneNumber: dto.exophoneNumber === undefined ? undefined : dto.exophoneNumber || null,
        whatsappPhoneNumberId: dto.whatsappPhoneNumberId === undefined ? undefined : dto.whatsappPhoneNumberId || null,
        businessCategory: dto.category,
        label: dto.label,
        updatedAt: new Date(),
      },
    });
    return this.toView(row);
  }

  async remove(id: string) {
    const existing = await this.prisma.businessNumber.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Business number ${id} not found`);
    await this.prisma.businessNumber.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Used by the telephony webhook to tag an inbound call's business
   * category from whichever number it came in on. Webhooks carry the
   * Exotel ExoPhone in their To/CallTo field, not the published business
   * line (carrier-level forwarding means Exotel never sees the originally
   * dialed number) -- so this looks up by exophoneNumber, not phoneNumber.
   * A number that isn't configured here honestly resolves to "unknown"
   * rather than a guess.
   */
  async resolveCategory(exophoneNumber: string | undefined): Promise<BusinessCategory> {
    if (!exophoneNumber) return 'unknown';
    const row = await this.prisma.businessNumber.findUnique({ where: { exophoneNumber } });
    return row?.businessCategory ?? 'unknown';
  }

  /**
   * True if the given number is one of our own configured ExoPhones. Used to
   * recognize Exotel's internal leg-completion webhooks (where the Connect
   * applet's own dial-out gets reported as if it were a fresh inbound call,
   * CallFrom/CallTo both set to the ExoPhone) so they aren't mistaken for a
   * real customer call -- a real customer's phone can never equal one of
   * these by definition.
   */
  async isOwnNumber(exophoneNumber: string): Promise<boolean> {
    const row = await this.prisma.businessNumber.findUnique({ where: { exophoneNumber } });
    return row !== null;
  }

  /** Same idea as resolveCategory, but keyed on Meta's WhatsApp Phone Number ID -- used by the WhatsApp calling webhook. */
  async resolveCategoryByWhatsAppId(whatsappPhoneNumberId: string | undefined): Promise<BusinessCategory> {
    if (!whatsappPhoneNumberId) return 'unknown';
    const row = await this.prisma.businessNumber.findUnique({ where: { whatsappPhoneNumberId } });
    return row?.businessCategory ?? 'unknown';
  }

  private toView(row: {
    id: string;
    phoneNumber: string;
    exophoneNumber: string | null;
    whatsappPhoneNumberId: string | null;
    businessCategory: BusinessCategory;
    label: string;
  }): BusinessNumberView {
    return {
      id: row.id,
      number: row.phoneNumber,
      exophoneNumber: row.exophoneNumber,
      whatsappPhoneNumberId: row.whatsappPhoneNumberId,
      category: row.businessCategory,
      label: row.label,
    };
  }
}
