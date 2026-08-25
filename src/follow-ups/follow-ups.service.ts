import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { endOfDayIST, startOfDayIST } from '../common/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { QueryFollowUpsDto } from './dto/query-follow-ups.dto';
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';

@Injectable()
export class FollowUpsService {
  constructor(private prisma: PrismaService) {}

  // Everything that describes the underlying call (not the follow-up task
  // itself) is filtered through this nested relation, same shape as
  // Calls/Customers' own where-building. Shared by findAll and counts so
  // the KPI tiles always reflect exactly the same filters as the list below
  // them, rather than drifting out of sync with each other.
  private buildWhere(query: QueryFollowUpsDto, opts: { includeStatus: boolean }): Prisma.FollowUpWhereInput {
    const callFilter: Prisma.CallWhereInput = {
      ...(query.category?.length && { businessCategory: { in: query.category } }),
      ...(query.branch?.length && { branch: { in: query.branch } }),
      ...(query.employeeId?.length && { employeeId: { in: query.employeeId } }),
      ...(query.productId?.length && { products: { some: { productId: { in: query.productId } } } }),
      ...(query.phone && { customer: { phoneNumber: { contains: query.phone } } }),
      ...((query.dateFrom || query.dateTo) && {
        callDate: {
          ...(query.dateFrom && { gte: startOfDayIST(query.dateFrom) }),
          ...(query.dateTo && { lt: endOfDayIST(query.dateTo) }),
        },
      }),
      ...(query.search && {
        OR: [
          { customer: { name: { contains: query.search, mode: 'insensitive' } } },
          { extraction: { summary: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
      ...((query.carMake?.length || query.carModel?.length || query.sentiment?.length) && {
        extraction: {
          ...(query.carMake?.length && { carMake: { in: query.carMake } }),
          ...(query.carModel?.length && { carModel: { in: query.carModel } }),
          ...(query.sentiment?.length && { sentiment: { in: query.sentiment } }),
        },
      }),
    };

    return {
      ...(opts.includeStatus && query.status && { status: query.status }),
      ...(query.assignedTo && { assignedTo: query.assignedTo }),
      ...(query.dueBefore && { dueDate: { lte: new Date(query.dueBefore) } }),
      ...(Object.keys(callFilter).length > 0 && { call: callFilter }),
    };
  }

  async findAll(query: QueryFollowUpsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildWhere(query, { includeStatus: true });

    const [items, total] = await Promise.all([
      this.prisma.followUp.findMany({
        where,
        include: { call: { include: { customer: true } }, employee: true },
        // Most recently created first (tracks the underlying call's
        // recency) rather than soonest-due-first -- staff want to see
        // follow-ups from calls that just happened at the top.
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.followUp.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /**
   * Powers the Pending/Missed/Completed KPI tiles -- deliberately excludes
   * query.status itself (grouping BY status wouldn't mean anything if
   * status were also a filter) but respects every other active filter, so
   * the tiles match what's actually shown in the list below them.
   */
  async counts(query: QueryFollowUpsDto) {
    const where = this.buildWhere(query, { includeStatus: false });
    const grouped = await this.prisma.followUp.groupBy({ by: ['status'], where, _count: true });
    return grouped.map((g) => ({ status: g.status, count: g._count }));
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
