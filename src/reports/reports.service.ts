import { Injectable } from '@nestjs/common';
import { Prisma, SentimentType } from '@prisma/client';
import { endOfDayIST, startOfDayIST } from '../common/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { QueryReportsDto } from './dto/query-reports.dto';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /** Shared category/employee/date-range/vehicle/sentiment/product filter, applied consistently across every report. */
  private buildCallWhere(filters: QueryReportsDto): Prisma.CallWhereInput {
    const extractionFilter: Prisma.CallExtractionWhereInput = {
      ...(filters.carMake && { carMake: { contains: filters.carMake, mode: 'insensitive' } }),
      ...(filters.carModel && { carModel: { contains: filters.carModel, mode: 'insensitive' } }),
      ...(filters.sentiment && { sentiment: filters.sentiment }),
    };

    return {
      ...(filters.category && { businessCategory: filters.category }),
      ...(filters.employeeId && { employeeId: filters.employeeId }),
      ...((filters.dateFrom || filters.dateTo) && {
        callDate: {
          ...(filters.dateFrom && { gte: startOfDayIST(filters.dateFrom) }),
          ...(filters.dateTo && { lt: endOfDayIST(filters.dateTo) }),
        },
      }),
      ...(Object.keys(extractionFilter).length > 0 && { extraction: extractionFilter }),
      ...(filters.productId && { products: { some: { productId: filters.productId } } }),
    };
  }

  /**
   * Same filter, as SQL fragments for the raw queries. `callAlias` is required
   * (every query has a calls table/alias); `extractionAlias` is only passed
   * when the query already joins call_extractions -- car make/model/sentiment
   * are extraction-scoped and can't be filtered without that join.
   */
  private buildCallConditions(filters: QueryReportsDto, callAlias: string, extractionAlias?: string): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [];
    if (filters.category) conditions.push(Prisma.sql`${Prisma.raw(callAlias)}.business_category = ${filters.category}::business_category`);
    if (filters.employeeId) conditions.push(Prisma.sql`${Prisma.raw(callAlias)}.employee_id = ${filters.employeeId}::uuid`);
    if (filters.dateFrom) conditions.push(Prisma.sql`${Prisma.raw(callAlias)}.call_date >= ${startOfDayIST(filters.dateFrom)}`);
    if (filters.dateTo) conditions.push(Prisma.sql`${Prisma.raw(callAlias)}.call_date < ${endOfDayIST(filters.dateTo)}`);
    if (filters.productId) {
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM call_products cpf WHERE cpf.call_id = ${Prisma.raw(callAlias)}.id AND cpf.product_id = ${filters.productId}::uuid)`,
      );
    }
    if (extractionAlias) {
      if (filters.carMake) conditions.push(Prisma.sql`${Prisma.raw(extractionAlias)}.car_make ILIKE ${'%' + filters.carMake + '%'}`);
      if (filters.carModel) conditions.push(Prisma.sql`${Prisma.raw(extractionAlias)}.car_model ILIKE ${'%' + filters.carModel + '%'}`);
      if (filters.sentiment) conditions.push(Prisma.sql`${Prisma.raw(extractionAlias)}.sentiment = ${filters.sentiment}::sentiment_type`);
    }
    return conditions;
  }

  private needsExtractionJoin(filters: QueryReportsDto): boolean {
    return Boolean(filters.carMake || filters.carModel || filters.sentiment);
  }

  async summary(filters: QueryReportsDto) {
    const base = this.buildCallWhere(filters);
    const [
      totalCalls,
      carGlasses,
      carMods,
      unknownCategory,
      followUpsPending,
      followUpsOverdue,
      durationAgg,
      budgetAgg,
      sentimentCounts,
      distinctCustomers,
    ] = await Promise.all([
      this.prisma.call.count({ where: base }),
      this.prisma.call.count({ where: { ...base, businessCategory: 'car_glasses' } }),
      this.prisma.call.count({ where: { ...base, businessCategory: 'car_modifications' } }),
      this.prisma.call.count({ where: { ...base, businessCategory: 'unknown' } }),
      this.prisma.followUp.count({ where: { status: 'pending', call: base } }),
      this.prisma.followUp.count({ where: { status: 'pending', dueDate: { lt: new Date() }, call: base } }),
      this.prisma.call.aggregate({ where: base, _avg: { durationSeconds: true } }),
      this.prisma.callExtraction.aggregate({ where: { call: base }, _sum: { budget: true } }),
      this.prisma.callExtraction.groupBy({ by: ['sentiment'], where: { sentiment: { not: null }, call: base }, _count: true }),
      this.prisma.call.groupBy({ by: ['customerId'], where: { ...base, customerId: { not: null } } }),
    ]);

    const sentimentTotal = sentimentCounts.reduce((sum, s) => sum + s._count, 0);
    const interestedCount = sentimentCounts.find((s) => s.sentiment === 'interested')?._count ?? 0;
    const totalBudget = budgetAgg._sum.budget != null ? Number(budgetAgg._sum.budget) : 0;
    const customerCount = distinctCustomers.length;

    return {
      totalCalls, // always equals carGlassesEnquiries + carModificationEnquiries + unknownCategoryEnquiries
      carGlassesEnquiries: carGlasses,
      carModificationEnquiries: carMods,
      unknownCategoryEnquiries: unknownCategory,
      followUpsPending,
      followUpsOverdue,
      avgCallDurationSeconds:
        durationAgg._avg.durationSeconds != null ? Math.round(durationAgg._avg.durationSeconds) : null,
      // Total stated budget across these calls, spread across the distinct
      // customers behind them -- an average expected spend per customer
      // rather than a lump sum that gets bigger just because more calls came in.
      budgetPotentialPerCustomer: customerCount > 0 ? Math.round(totalBudget / customerCount) : 0,
      interestedRate: sentimentTotal > 0 ? Math.round((interestedCount / sentimentTotal) * 100) : null,
    };
  }

  async callsByPeriod(granularity: 'daily' | 'weekly' | 'monthly' = 'daily', filters: QueryReportsDto = {}) {
    const trunc = granularity === 'monthly' ? 'month' : granularity === 'weekly' ? 'week' : 'day';
    const needsJoin = this.needsExtractionJoin(filters);
    const conditions = this.buildCallConditions(filters, 'calls', needsJoin ? 'ce' : undefined);
    const whereSql = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const joinSql = needsJoin ? Prisma.sql`LEFT JOIN call_extractions ce ON ce.call_id = calls.id` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<Array<{ period: Date; count: bigint }>>(Prisma.sql`
      SELECT date_trunc(${trunc}, call_date) AS period, COUNT(*)::bigint AS count
      FROM calls
      ${joinSql}
      ${whereSql}
      GROUP BY period
      ORDER BY period DESC
      LIMIT 90;
    `);
    // Postgres COUNT(*) comes back as a native bigint, which JSON.stringify
    // can't serialize -- narrow it to a number before it reaches the client.
    return rows.map((r) => ({ period: r.period, count: Number(r.count) }));
  }

  async followUpBreakdown(filters: QueryReportsDto = {}) {
    const grouped = await this.prisma.followUp.groupBy({
      by: ['status'],
      where: { call: this.buildCallWhere(filters) },
      _count: true,
    });
    return grouped.map((g) => ({ status: g.status, count: g._count }));
  }

  async sentimentBreakdown(filters: QueryReportsDto = {}) {
    const grouped = await this.prisma.callExtraction.groupBy({
      by: ['sentiment'],
      where: { sentiment: { not: null }, call: this.buildCallWhere(filters) },
      _count: true,
    });
    return grouped
      .filter((g): g is typeof g & { sentiment: SentimentType } => g.sentiment != null)
      .map((g) => ({ sentiment: g.sentiment, count: g._count }));
  }

  async topCarModels(limit = 10, filters: QueryReportsDto = {}) {
    const conditions = [
      Prisma.sql`ce.car_model IS NOT NULL AND ce.car_model <> ''`,
      ...this.buildCallConditions(filters, 'c', 'ce'),
    ];

    const rows = await this.prisma.$queryRaw<Array<{ car_model: string; count: bigint }>>(Prisma.sql`
      SELECT ce.car_model, COUNT(*)::bigint AS count
      FROM call_extractions ce
      JOIN calls c ON c.id = ce.call_id
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY ce.car_model
      ORDER BY count DESC
      LIMIT ${limit};
    `);
    return rows.map((r) => ({ car_model: r.car_model, count: Number(r.count) }));
  }

  async topProducts(limit = 10, filters: QueryReportsDto = {}) {
    const needsJoin = this.needsExtractionJoin(filters);
    const conditions = this.buildCallConditions(filters, 'c', needsJoin ? 'ce' : undefined);
    const whereSql = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const joinSql = needsJoin ? Prisma.sql`LEFT JOIN call_extractions ce ON ce.call_id = c.id` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<Array<{ name: string; category: string; count: bigint }>>(Prisma.sql`
      SELECT p.name, p.category, COUNT(*)::bigint AS count
      FROM call_products cp
      JOIN products p ON p.id = cp.product_id
      JOIN calls c ON c.id = cp.call_id
      ${joinSql}
      ${whereSql}
      GROUP BY p.id, p.name, p.category
      ORDER BY count DESC
      LIMIT ${limit};
    `);
    return rows.map((r) => ({ name: r.name, category: r.category, count: Number(r.count) }));
  }

  async topEmployees(limit = 10, filters: QueryReportsDto = {}) {
    const needsJoin = this.needsExtractionJoin(filters);
    const conditions = [Prisma.sql`c.employee_id IS NOT NULL`, ...this.buildCallConditions(filters, 'c', needsJoin ? 'ce' : undefined)];
    const joinSql = needsJoin ? Prisma.sql`LEFT JOIN call_extractions ce ON ce.call_id = c.id` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<Array<{ name: string; count: bigint }>>(Prisma.sql`
      SELECT e.name, COUNT(*)::bigint AS count
      FROM calls c
      JOIN employees e ON e.id = c.employee_id
      ${joinSql}
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY e.id, e.name
      ORDER BY count DESC
      LIMIT ${limit};
    `);
    return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
  }
}
