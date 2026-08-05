import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryFollowUpsDto } from './dto/query-follow-ups.dto';
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';

@Injectable()
export class FollowUpsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryFollowUpsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.FollowUpWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.assignedTo && { assignedTo: query.assignedTo }),
      ...(query.dueBefore && { dueDate: { lte: new Date(query.dueBefore) } }),
    };

    const [items, total] = await Promise.all([
      this.prisma.followUp.findMany({
        where,
        include: { call: { include: { customer: true } }, employee: true },
        orderBy: { dueDate: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.followUp.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async update(id: string, dto: UpdateFollowUpDto) {
    const existing = await this.prisma.followUp.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Follow-up ${id} not found`);

    return this.prisma.followUp.update({
      where: { id },
      data: {
        status: dto.status,
        assignedTo: dto.assignedTo,
        notes: dto.notes,
        completedAt: dto.status === 'completed' ? new Date() : undefined,
      },
    });
  }
}
