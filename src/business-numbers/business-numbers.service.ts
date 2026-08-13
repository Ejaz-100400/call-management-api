import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BusinessCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBusinessNumberDto } from './dto/create-business-number.dto';
import { UpdateBusinessNumberDto } from './dto/update-business-number.dto';

export interface BusinessNumberView {
  id: string;
  number: string;
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
      data: { phoneNumber: dto.phoneNumber, businessCategory: dto.category, label: dto.label },
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
      data: { phoneNumber: dto.phoneNumber, businessCategory: dto.category, label: dto.label, updatedAt: new Date() },
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
   * category from whichever number it came in on. Unlike the old
   * env-var-based version (which always guessed "car_modifications" for
   * anything that wasn't the glasses number), a number that isn't
   * configured here honestly resolves to "unknown" rather than a guess.
   */
  async resolveCategory(businessNumber: string | undefined): Promise<BusinessCategory> {
    if (!businessNumber) return 'unknown';
    const row = await this.prisma.businessNumber.findUnique({ where: { phoneNumber: businessNumber } });
    return row?.businessCategory ?? 'unknown';
  }

  private toView(row: { id: string; phoneNumber: string; businessCategory: BusinessCategory; label: string }): BusinessNumberView {
    return { id: row.id, number: row.phoneNumber, category: row.businessCategory, label: row.label };
  }
}
