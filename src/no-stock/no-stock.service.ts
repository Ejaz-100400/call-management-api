import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dateOnly } from '../common/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNoStockRequestDto } from './dto/create-no-stock-request.dto';
import { QueryNoStockRequestsDto } from './dto/query-no-stock-requests.dto';
import { UpdateNoStockRequestDto } from './dto/update-no-stock-request.dto';

@Injectable()
export class NoStockService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryNoStockRequestsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.NoStockRequestWhereInput = {
      ...(query.category?.length && { category: { in: query.category } }),
      ...(query.search && {
        OR: [
          { customerName: { contains: query.search, mode: 'insensitive' } },
          { customerPhone: { contains: query.search } },
          { itemName: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
      // requestDate is a date-only column -- plain date bounds, not the IST
      // timestamp helpers (see dateOnly in timezone.util.ts).
      ...((query.dateFrom || query.dateTo) && {
        requestDate: {
          ...(query.dateFrom && { gte: dateOnly(query.dateFrom) }),
          ...(query.dateTo && { lte: dateOnly(query.dateTo) }),
        },
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.noStockRequest.findMany({
        where,
        include: { enteredBy: { select: { name: true } } },
        orderBy: [{ requestDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.noStockRequest.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  // Same find-or-create-by-phone the sales, enquiries and appointments use,
  // so a request lands on the same customer (and call history) as their calls.
  private async linkCustomer(phone: string) {
    return this.prisma.customer.upsert({ where: { phoneNumber: phone }, create: { phoneNumber: phone }, update: {} });
  }

  async create(dto: CreateNoStockRequestDto, userId: string) {
    const customerPhone = dto.customerPhone.trim();
    const customer = await this.linkCustomer(customerPhone);

    return this.prisma.noStockRequest.create({
      data: {
        customerName: dto.customerName.trim(),
        customerPhone,
        customerId: customer.id,
        location: dto.location?.trim() || null,
        itemName: dto.itemName.trim(),
        category: dto.category,
        requestDate: dateOnly(dto.requestDate),
        enteredByUserId: userId,
      },
      include: { enteredBy: { select: { name: true } } },
    });
  }

  async update(id: string, dto: UpdateNoStockRequestDto) {
    const existing = await this.prisma.noStockRequest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Request ${id} not found`);

    // Only re-link the customer when the phone actually changed.
    let phoneFields: { customerPhone: string; customerId: string } | undefined;
    const newPhone = dto.customerPhone?.trim();
    if (newPhone && newPhone !== existing.customerPhone) {
      phoneFields = { customerPhone: newPhone, customerId: (await this.linkCustomer(newPhone)).id };
    }

    return this.prisma.noStockRequest.update({
      where: { id },
      data: {
        customerName: dto.customerName?.trim(),
        ...phoneFields,
        location: dto.location !== undefined ? dto.location.trim() || null : undefined,
        itemName: dto.itemName?.trim(),
        category: dto.category,
        requestDate: dto.requestDate ? dateOnly(dto.requestDate) : undefined,
      },
      include: { enteredBy: { select: { name: true } } },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.noStockRequest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Request ${id} not found`);
    await this.prisma.noStockRequest.delete({ where: { id } });
    return { deleted: true };
  }
}
