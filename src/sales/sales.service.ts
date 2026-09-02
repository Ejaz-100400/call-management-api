import { Injectable, NotFoundException } from '@nestjs/common';
import { Branch, Prisma } from '@prisma/client';
import { dateOnly, endOfDayIST, istMinuteOfDay, startOfDayIST, todayIST } from '../common/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { QuerySalesDto } from './dto/query-sales.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';

const ALL_BRANCHES: Branch[] = ['ambattur', 'kattankulathur', 'sithalapakkam', 'pondicherry'];
// 20:30 IST, expressed in minutes since IST midnight -- see istMinuteOfDay.
const REMINDER_CUTOFF_MINUTE = 20 * 60 + 30;

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QuerySalesDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.SaleWhereInput = {
      ...(query.branch?.length && { branch: { in: query.branch } }),
      ...(query.source?.length && { source: { in: query.source } }),
      ...(query.phone && { customerPhone: { contains: query.phone } }),
      ...((query.dateFrom || query.dateTo) && {
        saleDate: {
          ...(query.dateFrom && { gte: dateOnly(query.dateFrom) }),
          ...(query.dateTo && { lte: dateOnly(query.dateTo) }),
        },
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phoneNumber: true } },
          matchedCall: { select: { id: true, callDate: true, businessCategory: true } },
          enteredBy: { select: { name: true } },
        },
        orderBy: { saleDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.sale.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /**
   * Looks up a phone number against existing customer/call history so the
   * Sales Entry form can show "already called us" instead of the person
   * entering it guessing at the source. Read-only -- unlike the call
   * webhook's findOrCreateCustomer, a lookup with no match should never
   * silently create a Customer row.
   */
  async match(phone: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { phoneNumber: phone },
      select: {
        id: true,
        name: true,
        carMake: true,
        carModel: true,
        calls: {
          orderBy: { callDate: 'desc' },
          take: 5,
          select: {
            id: true,
            callDate: true,
            businessCategory: true,
            employee: { select: { name: true } },
            extraction: { select: { sentiment: true, summary: true } },
          },
        },
      },
    });
    if (!customer) return { matched: false as const };
    return { matched: true as const, customer };
  }

  async create(dto: CreateSaleDto, userId: string) {
    const customer = await this.prisma.customer.upsert({
      where: { phoneNumber: dto.customerPhone },
      create: { phoneNumber: dto.customerPhone },
      update: {},
    });

    return this.prisma.sale.create({
      data: {
        customerPhone: dto.customerPhone,
        customerId: customer.id,
        carMake: dto.carMake,
        carModel: dto.carModel,
        branch: dto.branch,
        saleDate: new Date(dto.saleDate),
        source: dto.source ?? 'unknown',
        matchedCallId: dto.matchedCallId,
        notes: dto.notes,
        enteredByUserId: userId,
      },
      include: { customer: true, matchedCall: true },
    });
  }

  async update(id: string, dto: UpdateSaleDto) {
    const existing = await this.prisma.sale.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Sale ${id} not found`);

    // Only re-link the Customer when the phone actually changed -- an
    // unrelated field edit (branch, source, notes) shouldn't touch it.
    let customerId: string | undefined;
    if (dto.customerPhone !== undefined && dto.customerPhone !== existing.customerPhone) {
      const customer = await this.prisma.customer.upsert({
        where: { phoneNumber: dto.customerPhone },
        create: { phoneNumber: dto.customerPhone },
        update: {},
      });
      customerId = customer.id;
    }

    return this.prisma.sale.update({
      where: { id },
      data: {
        customerPhone: dto.customerPhone,
        customerId,
        carMake: dto.carMake,
        carModel: dto.carModel,
        branch: dto.branch,
        saleDate: dto.saleDate ? new Date(dto.saleDate) : undefined,
        source: dto.source,
        matchedCallId: dto.matchedCallId,
        notes: dto.notes,
      },
      include: { customer: true, matchedCall: true, enteredBy: { select: { name: true } } },
    });
  }

  /**
   * Drives the site-wide 8:30 PM reminder banner. Server-computed (not
   * trusting the client's clock/timezone) -- afterCutoff stays false, and
   * missingBranches stays empty, for the whole day until 20:30 IST, then
   * flips to whichever of the 4 branches genuinely have zero Sale rows for
   * today. Entering a branch's sales before the cutoff means that branch
   * just never shows up in missingBranches once the cutoff passes.
   */
  async reminderStatus() {
    const nowMinute = istMinuteOfDay(new Date());
    if (nowMinute < REMINDER_CUTOFF_MINUTE) {
      return { afterCutoff: false, missingBranches: [] as Branch[] };
    }

    const today = todayIST();
    const todaysSales = await this.prisma.sale.findMany({
      where: { saleDate: dateOnly(today) },
      select: { branch: true },
      distinct: ['branch'],
    });
    const coveredBranches = new Set(todaysSales.map((s) => s.branch));
    const missingBranches = ALL_BRANCHES.filter((b) => !coveredBranches.has(b));

    return { afterCutoff: true, missingBranches };
  }

  /**
   * Call->sale and walk-in->sale conversion, for the Customer Tracker
   * page's summary tiles. Denominator for call->sale is calls the AI read
   * as genuinely worth following up on (interested or needs_follow_up) --
   * a "not_interested" call was never a real conversion opportunity, so
   * counting it in the denominator would understate the real rate.
   */
  async conversionSummary(filters: { dateFrom?: string; dateTo?: string; branch?: Branch[] }) {
    // Sale.saleDate/InPersonEnquiry.enquiryDate are date-only columns and
    // need `dateOnly` bounds; Call.callDate is a timestamptz and needs the
    // IST-day-boundary bounds -- these are NOT interchangeable, see dateOnly's
    // doc comment in timezone.util.ts.
    const dateOnlyWhere = (filters.dateFrom || filters.dateTo) && {
      ...(filters.dateFrom && { gte: dateOnly(filters.dateFrom) }),
      ...(filters.dateTo && { lte: dateOnly(filters.dateTo) }),
    };
    const callDateWhere = (filters.dateFrom || filters.dateTo) && {
      ...(filters.dateFrom && { gte: startOfDayIST(filters.dateFrom) }),
      ...(filters.dateTo && { lt: endOfDayIST(filters.dateTo) }),
    };

    const saleWhere: Prisma.SaleWhereInput = {
      ...(filters.branch?.length && { branch: { in: filters.branch } }),
      ...(dateOnlyWhere && { saleDate: dateOnlyWhere }),
    };
    const enquiryWhere: Prisma.InPersonEnquiryWhereInput = {
      ...(filters.branch?.length && { branch: { in: filters.branch } }),
      ...(dateOnlyWhere && { enquiryDate: dateOnlyWhere }),
    };
    const callWhere: Prisma.CallWhereInput = {
      ...(filters.branch?.length && { branch: { in: filters.branch } }),
      ...(callDateWhere && { callDate: callDateWhere }),
      extraction: { sentiment: { in: ['interested', 'needs_follow_up'] } },
    };

    const [salesBySource, enquiriesByOutcome, interestedCallCount, callSourceSaleCount] = await Promise.all([
      this.prisma.sale.groupBy({ by: ['source'], where: saleWhere, _count: true }),
      this.prisma.inPersonEnquiry.groupBy({ by: ['outcome'], where: enquiryWhere, _count: true }),
      this.prisma.call.count({ where: callWhere }),
      this.prisma.sale.count({ where: { ...saleWhere, source: 'call' } }),
    ]);

    const totalSales = salesBySource.reduce((sum, s) => sum + s._count, 0);
    const totalEnquiries = enquiriesByOutcome.reduce((sum, e) => sum + e._count, 0);
    const purchasedEnquiries = enquiriesByOutcome.find((e) => e.outcome === 'purchased')?._count ?? 0;

    return {
      totalSales,
      salesBySource: salesBySource.map((s) => ({ source: s.source, count: s._count })),
      totalEnquiries,
      purchasedEnquiries,
      callToSaleRate: interestedCallCount > 0 ? Math.round((callSourceSaleCount / interestedCallCount) * 100) : null,
      walkInToSaleRate: totalEnquiries > 0 ? Math.round((purchasedEnquiries / totalEnquiries) * 100) : null,
    };
  }
}
