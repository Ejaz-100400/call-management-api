import { Injectable } from '@nestjs/common';
import { BusinessCategory, Prisma, SentimentType } from '@prisma/client';
import { dateOnly, endOfDayIST, startOfDayIST } from '../common/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { QueryReportsDto } from './dto/query-reports.dto';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /** Shared category/branch/employee/date-range/vehicle/sentiment/product filter, applied consistently across every report. */
  private buildCallWhere(filters: QueryReportsDto): Prisma.CallWhereInput {
    const extractionFilter: Prisma.CallExtractionWhereInput = {
      ...(filters.carMake?.length && { carMake: { in: filters.carMake } }),
      ...(filters.carModel?.length && { carModel: { in: filters.carModel } }),
      ...(filters.sentiment?.length && { sentiment: { in: filters.sentiment } }),
    };

    return {
      ...(filters.category?.length && { businessCategory: { in: filters.category } }),
      ...(filters.branch?.length && { branch: { in: filters.branch } }),
      ...(filters.status?.length && { status: { in: filters.status } }),
      ...(filters.employeeId?.length && { employeeId: { in: filters.employeeId } }),
      ...((filters.dateFrom || filters.dateTo) && {
        callDate: {
          ...(filters.dateFrom && { gte: startOfDayIST(filters.dateFrom) }),
          ...(filters.dateTo && { lt: endOfDayIST(filters.dateTo) }),
        },
      }),
      ...(Object.keys(extractionFilter).length > 0 && { extraction: extractionFilter }),
      ...(filters.productId?.length && { products: { some: { productId: { in: filters.productId } } } }),
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
    if (filters.category?.length) {
      conditions.push(
        Prisma.sql`${Prisma.raw(callAlias)}.business_category IN (${Prisma.join(filters.category.map((c) => Prisma.sql`${c}::business_category`))})`,
      );
    }
    if (filters.employeeId?.length) {
      conditions.push(
        Prisma.sql`${Prisma.raw(callAlias)}.employee_id IN (${Prisma.join(filters.employeeId.map((id) => Prisma.sql`${id}::uuid`))})`,
      );
    }
    if (filters.branch?.length) {
      conditions.push(Prisma.sql`${Prisma.raw(callAlias)}.branch IN (${Prisma.join(filters.branch.map((b) => Prisma.sql`${b}::branch`))})`);
    }
    if (filters.status?.length) {
      conditions.push(
        Prisma.sql`${Prisma.raw(callAlias)}.status IN (${Prisma.join(filters.status.map((s) => Prisma.sql`${s}::call_status`))})`,
      );
    }
    if (filters.dateFrom) conditions.push(Prisma.sql`${Prisma.raw(callAlias)}.call_date >= ${startOfDayIST(filters.dateFrom)}`);
    if (filters.dateTo) conditions.push(Prisma.sql`${Prisma.raw(callAlias)}.call_date < ${endOfDayIST(filters.dateTo)}`);
    if (filters.productId?.length) {
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM call_products cpf WHERE cpf.call_id = ${Prisma.raw(callAlias)}.id AND cpf.product_id IN (${Prisma.join(filters.productId.map((id) => Prisma.sql`${id}::uuid`))}))`,
      );
    }
    if (extractionAlias) {
      if (filters.carMake?.length) {
        conditions.push(Prisma.sql`${Prisma.raw(extractionAlias)}.car_make IN (${Prisma.join(filters.carMake.map((m) => Prisma.sql`${m}`))})`);
      }
      if (filters.carModel?.length) {
        conditions.push(Prisma.sql`${Prisma.raw(extractionAlias)}.car_model IN (${Prisma.join(filters.carModel.map((m) => Prisma.sql`${m}`))})`);
      }
      if (filters.sentiment?.length) {
        conditions.push(
          Prisma.sql`${Prisma.raw(extractionAlias)}.sentiment IN (${Prisma.join(filters.sentiment.map((s) => Prisma.sql`${s}::sentiment_type`))})`,
        );
      }
    }
    return conditions;
  }

  private needsExtractionJoin(filters: QueryReportsDto): boolean {
    return Boolean(filters.carMake?.length || filters.carModel?.length || filters.sentiment?.length);
  }

  // Same reasoning as FollowUpsService: historical imported data never
  // represented real, actionable callback work, so it's excluded from any
  // metric about how follow-ups are actually being worked.
  private static readonly IMPORT_CUTOFF = startOfDayIST('2026-08-17');

  async summary(filters: QueryReportsDto) {
    const base = this.buildCallWhere(filters);
    const followUpCallFilter: Prisma.CallWhereInput = {
      ...base,
      NOT: { callDate: { lt: ReportsService.IMPORT_CUTOFF }, extraction: { extractedByModel: 'manual_import' } },
    };
    // Sales don't carry every dimension a call does (no car make/sentiment/
    // product to filter by) -- scoped to the two fields they do share with
    // the rest of this report, branch and date range, same as Customer
    // Tracker's own conversion summary uses.
    const salesDateBranchWhere: Prisma.SaleWhereInput = {
      ...(filters.branch?.length && { branch: { in: filters.branch } }),
      // Sale.saleDate is a date-only column -- dateOnly bounds, not the
      // timestamptz-oriented startOfDayIST/endOfDayIST used for callDate
      // above. See dateOnly's doc comment in timezone.util.ts.
      ...((filters.dateFrom || filters.dateTo) && {
        saleDate: {
          ...(filters.dateFrom && { gte: dateOnly(filters.dateFrom) }),
          ...(filters.dateTo && { lte: dateOnly(filters.dateTo) }),
        },
      }),
    };
    const salesWhere: Prisma.SaleWhereInput = { ...salesDateBranchWhere, source: 'call' };
    // Same source-mix question as dailyRates()'s socialMediaToSaleRate --
    // % of total sales (any source) that came through a social/messaging
    // channel, not a calls-converting metric like callToSaleRate above.
    const socialSalesWhere: Prisma.SaleWhereInput = {
      ...salesDateBranchWhere,
      source: { in: ['instagram', 'facebook', 'youtube', 'whatsapp'] },
    };

    const [
      totalCalls,
      carGlasses,
      carMods,
      unknownCategory,
      followUpsPending,
      followUpsOverdue,
      durationAgg,
      sentimentCounts,
      customerCallCounts,
      followUpStatusCounts,
      callSourcedSales,
      totalSalesCount,
      socialSalesCount,
    ] = await Promise.all([
      this.prisma.call.count({ where: base }),
      this.prisma.call.count({ where: { ...base, businessCategory: 'car_glasses' } }),
      this.prisma.call.count({ where: { ...base, businessCategory: 'car_modifications' } }),
      this.prisma.call.count({ where: { ...base, businessCategory: 'unknown' } }),
      this.prisma.followUp.count({ where: { status: 'pending', call: base } }),
      this.prisma.followUp.count({ where: { status: 'pending', dueDate: { lt: new Date() }, call: base } }),
      this.prisma.call.aggregate({ where: base, _avg: { durationSeconds: true } }),
      this.prisma.callExtraction.groupBy({ by: ['sentiment'], where: { sentiment: { not: null }, call: base }, _count: true }),
      this.prisma.call.groupBy({ by: ['customerId'], where: { ...base, customerId: { not: null } }, _count: true }),
      this.prisma.followUp.groupBy({ by: ['status'], where: { call: followUpCallFilter }, _count: true }),
      this.prisma.sale.count({ where: salesWhere }),
      this.prisma.sale.count({ where: salesDateBranchWhere }),
      this.prisma.sale.count({ where: socialSalesWhere }),
    ]);

    const sentimentTotal = sentimentCounts.reduce((sum, s) => sum + s._count, 0);
    const interestedCount = sentimentCounts.find((s) => s.sentiment === 'interested')?._count ?? 0;
    const needsFollowUpCount = sentimentCounts.find((s) => s.sentiment === 'needs_follow_up')?._count ?? 0;
    const customerCount = customerCallCounts.length;
    // Denominator is calls the AI read as genuinely worth following up on
    // (interested or needs_follow_up) -- a "not_interested" call was never
    // a real conversion opportunity, so counting it would understate the
    // real rate. Same reasoning as Customer Tracker's own callToSaleRate.
    const conversionOpportunityCount = interestedCount + needsFollowUpCount;
    // A "returning" customer is one with more than one call within this
    // filtered set -- narrowing the filters (e.g. to a date range) narrows
    // this count right along with it, same as every other tile here.
    const returningCustomerCount = customerCallCounts.filter((c) => c._count > 1).length;

    // % of follow-ups actually closed out, distinct from interestedRate
    // (which reads sentiment, not whether anyone acted on it). Excludes
    // imported historical follow-ups the same way the Follow-ups page does.
    const followUpTotal = followUpStatusCounts.reduce((sum, s) => sum + s._count, 0);
    const followUpCompletedCount = followUpStatusCounts.find((s) => s.status === 'completed')?._count ?? 0;
    const followUpMissedCount = followUpStatusCounts.find((s) => s.status === 'missed')?._count ?? 0;

    return {
      totalCalls, // always equals carGlassesEnquiries + carModificationEnquiries + unknownCategoryEnquiries
      carGlassesEnquiries: carGlasses,
      carModificationEnquiries: carMods,
      unknownCategoryEnquiries: unknownCategory,
      followUpsPending,
      followUpsOverdue,
      // From 17 Aug 2026 onward only (imported historical data excluded) --
      // same window as followUpCompletionRate below.
      followUpsCompleted: followUpCompletedCount,
      followUpsMissed: followUpMissedCount,
      avgCallDurationSeconds:
        durationAgg._avg.durationSeconds != null ? Math.round(durationAgg._avg.durationSeconds) : null,
      interestedRate: sentimentTotal > 0 ? Math.round((interestedCount / sentimentTotal) * 100) : null,
      followUpCompletionRate: followUpTotal > 0 ? Math.round((followUpCompletedCount / followUpTotal) * 100) : null,
      // % of "worth following up on" calls that turned into a call-sourced
      // sale (Sale.source = 'call') -- scoped to this report's branch/date
      // filters (see salesWhere above for why not every filter applies).
      callToSaleRate: conversionOpportunityCount > 0 ? Math.round((callSourcedSales / conversionOpportunityCount) * 100) : null,
      // % of total sales (any source) that came through Instagram/Facebook/
      // YouTube/WhatsApp -- same definition as dailyRates()'s
      // socialMediaToSaleRate, just for the whole filtered window at once.
      socialMediaToSaleRate: totalSalesCount > 0 ? Math.round((socialSalesCount / totalSalesCount) * 100) : null,
      totalCustomers: customerCount,
      returningCustomers: returningCustomerCount,
    };
  }

  /**
   * Broken out per business category (car_glasses / car_modifications /
   * unknown) so the volume chart can plot Glasses vs Modifications as
   * separate lines instead of one blended total. Grouping happens two ways
   * at once -- period AND category -- so the LIMIT can't be applied in SQL
   * (it would cap rows, not periods, cutting off whichever category comes
   * later in category order for a period near the boundary); pivot into one
   * row per period first, then take the most recent 90 periods.
   */
  async callsByPeriod(granularity: 'hourly' | 'daily' | 'weekly' | 'monthly' = 'daily', filters: QueryReportsDto = {}) {
    const trunc =
      granularity === 'monthly' ? 'month' : granularity === 'weekly' ? 'week' : granularity === 'hourly' ? 'hour' : 'day';
    const needsJoin = this.needsExtractionJoin(filters);
    const conditions = this.buildCallConditions(filters, 'calls', needsJoin ? 'ce' : undefined);
    const whereSql = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const joinSql = needsJoin ? Prisma.sql`LEFT JOIN call_extractions ce ON ce.call_id = calls.id` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<Array<{ period: Date; business_category: BusinessCategory; count: bigint }>>(Prisma.sql`
      SELECT date_trunc(${trunc}, calls.call_date) AS period, calls.business_category, COUNT(*)::bigint AS count
      FROM calls
      ${joinSql}
      ${whereSql}
      GROUP BY period, calls.business_category
      ORDER BY period DESC;
    `);

    const byPeriod = new Map<number, { period: Date; carGlasses: number; carModifications: number; unknown: number }>();
    for (const r of rows) {
      const key = r.period.getTime();
      const entry = byPeriod.get(key) ?? { period: r.period, carGlasses: 0, carModifications: 0, unknown: 0 };
      if (r.business_category === 'car_glasses') entry.carGlasses = Number(r.count);
      else if (r.business_category === 'car_modifications') entry.carModifications = Number(r.count);
      else entry.unknown = Number(r.count);
      byPeriod.set(key, entry);
    }

    return Array.from(byPeriod.values())
      .sort((a, b) => b.period.getTime() - a.period.getTime())
      .slice(0, 90);
  }

  /**
   * Same three rates as summary() (interestedRate, callToSaleRate,
   * followUpCompletionRate), broken out per day -- powers the Calendar
   * tab's rate-based view. callToSaleRate here uses the exact same
   * attribution as summary()'s: a sale counts toward whatever day it was
   * *recorded* on (Sale.saleDate), not the day of the call that led to it --
   * same workflow, just narrowed to one day's window instead of the whole
   * filtered period.
   */
  async dailyRates(filters: QueryReportsDto = {}) {
    const conditions = this.buildCallConditions(filters, 'calls', 'ce');
    const whereSql = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    // Same "exclude imported historical follow-up data" rule summary() applies.
    const notImportExcluded = Prisma.sql`NOT (calls.call_date < ${ReportsService.IMPORT_CUTOFF} AND ce.extracted_by_model = 'manual_import')`;

    const rows = await this.prisma.$queryRaw<
      Array<{
        period: Date;
        sentiment_total: bigint;
        interested_count: bigint;
        opportunity_count: bigint;
        fu_total: bigint;
        fu_completed: bigint;
      }>
    >(Prisma.sql`
      SELECT
        date_trunc('day', calls.call_date) AS period,
        COUNT(*) FILTER (WHERE ce.sentiment IS NOT NULL) AS sentiment_total,
        COUNT(*) FILTER (WHERE ce.sentiment = 'interested') AS interested_count,
        COUNT(*) FILTER (WHERE ce.sentiment IN ('interested', 'needs_follow_up')) AS opportunity_count,
        COUNT(*) FILTER (WHERE fu.id IS NOT NULL AND ${notImportExcluded}) AS fu_total,
        COUNT(*) FILTER (WHERE fu.status = 'completed' AND ${notImportExcluded}) AS fu_completed
      FROM calls
      LEFT JOIN call_extractions ce ON ce.call_id = calls.id
      LEFT JOIN follow_ups fu ON fu.call_id = calls.id
      ${whereSql}
      GROUP BY period
      ORDER BY period DESC;
    `);

    // Same salesWhere shape as summary()'s callToSaleRate -- branch + date
    // range, keyed on the sale's own saleDate.
    const salesByDay = await this.prisma.sale.groupBy({
      by: ['saleDate'],
      where: {
        source: 'call',
        ...(filters.branch?.length && { branch: { in: filters.branch } }),
        // saleDate is date-only -- dateOnly bounds, not the timestamptz
        // startOfDayIST/endOfDayIST used for call_date above.
        ...((filters.dateFrom || filters.dateTo) && {
          saleDate: {
            ...(filters.dateFrom && { gte: dateOnly(filters.dateFrom) }),
            ...(filters.dateTo && { lte: dateOnly(filters.dateTo) }),
          },
        }),
      },
      _count: true,
    });
    const salesCountByDay = new Map<number, number>();
    for (const s of salesByDay) salesCountByDay.set(s.saleDate.getTime(), s._count);

    // % of a day's total sales (any source) that came in through a social/
    // messaging channel -- a completely different question from
    // callToSaleRate above (which is calls converting), so it's kept as its
    // own query rather than folded into salesByDay's source:'call' filter.
    const socialSalesConditions: Prisma.Sql[] = [];
    if (filters.branch?.length) {
      socialSalesConditions.push(Prisma.sql`branch IN (${Prisma.join(filters.branch.map((b) => Prisma.sql`${b}::branch`))})`);
    }
    if (filters.dateFrom) socialSalesConditions.push(Prisma.sql`sale_date >= ${dateOnly(filters.dateFrom)}`);
    if (filters.dateTo) socialSalesConditions.push(Prisma.sql`sale_date <= ${dateOnly(filters.dateTo)}`);
    const socialSalesWhereSql =
      socialSalesConditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(socialSalesConditions, ' AND ')}` : Prisma.empty;

    const socialSalesByDay = await this.prisma.$queryRaw<Array<{ sale_date: Date; total: bigint; social_count: bigint }>>(Prisma.sql`
      SELECT
        sale_date,
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE source IN ('instagram', 'facebook', 'youtube', 'whatsapp'))::bigint AS social_count
      FROM sales
      ${socialSalesWhereSql}
      GROUP BY sale_date;
    `);
    const socialMediaRateByDay = new Map<number, number | null>();
    for (const s of socialSalesByDay) {
      const total = Number(s.total);
      const social = Number(s.social_count);
      socialMediaRateByDay.set(s.sale_date.getTime(), total > 0 ? Math.round((social / total) * 100) : null);
    }

    return rows
      .map((r) => {
        const sentimentTotal = Number(r.sentiment_total);
        const interestedCount = Number(r.interested_count);
        const opportunityCount = Number(r.opportunity_count);
        const fuTotal = Number(r.fu_total);
        const fuCompleted = Number(r.fu_completed);
        const convertedCount = salesCountByDay.get(r.period.getTime()) ?? 0;
        return {
          period: r.period.toISOString(),
          interestedRate: sentimentTotal > 0 ? Math.round((interestedCount / sentimentTotal) * 100) : null,
          callToSaleRate: opportunityCount > 0 ? Math.round((convertedCount / opportunityCount) * 100) : null,
          followUpCompletionRate: fuTotal > 0 ? Math.round((fuCompleted / fuTotal) * 100) : null,
          socialMediaToSaleRate: socialMediaRateByDay.get(r.period.getTime()) ?? null,
        };
      })
      .sort((a, b) => (a.period < b.period ? 1 : -1))
      .slice(0, 90);
  }

  /** Distinct customers per period (not call count) -- shows growth in who's calling, not just how often. */
  async customersByPeriod(granularity: 'daily' | 'weekly' | 'monthly' = 'daily', filters: QueryReportsDto = {}) {
    const trunc = granularity === 'monthly' ? 'month' : granularity === 'weekly' ? 'week' : 'day';
    const needsJoin = this.needsExtractionJoin(filters);
    const conditions = [Prisma.sql`calls.customer_id IS NOT NULL`, ...this.buildCallConditions(filters, 'calls', needsJoin ? 'ce' : undefined)];
    const whereSql = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
    const joinSql = needsJoin ? Prisma.sql`LEFT JOIN call_extractions ce ON ce.call_id = calls.id` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<Array<{ period: Date; count: bigint }>>(Prisma.sql`
      SELECT date_trunc(${trunc}, call_date) AS period, COUNT(DISTINCT customer_id)::bigint AS count
      FROM calls
      ${joinSql}
      ${whereSql}
      GROUP BY period
      ORDER BY period DESC
      LIMIT 90;
    `);
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
      // "Unknown"/"<UNKNOWN>" is a placeholder the AI extraction writes when
      // it couldn't determine the model, not a real answer worth charting.
      Prisma.sql`ce.car_model IS NOT NULL AND ce.car_model <> '' AND lower(ce.car_model) NOT IN ('unknown', '<unknown>')`,
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

  async topCarMakes(limit = 10, filters: QueryReportsDto = {}) {
    const conditions = [
      // Same reasoning as topCarModels -- "Unknown" is a placeholder, not a real make.
      Prisma.sql`ce.car_make IS NOT NULL AND ce.car_make <> '' AND lower(ce.car_make) NOT IN ('unknown', '<unknown>')`,
      ...this.buildCallConditions(filters, 'c', 'ce'),
    ];

    const rows = await this.prisma.$queryRaw<Array<{ car_make: string; count: bigint }>>(Prisma.sql`
      SELECT ce.car_make, COUNT(*)::bigint AS count
      FROM call_extractions ce
      JOIN calls c ON c.id = ce.call_id
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY ce.car_make
      ORDER BY count DESC
      LIMIT ${limit};
    `);
    return rows.map((r) => ({ car_make: r.car_make, count: Number(r.count) }));
  }

  async topProducts(limit = 10, filters: QueryReportsDto = {}) {
    const needsJoin = this.needsExtractionJoin(filters);
    // No product in the catalog is actually named "Unknown" today, but this
    // guards against one slipping in the same way it did for car make/model.
    const conditions = [Prisma.sql`lower(p.name) <> 'unknown'`, ...this.buildCallConditions(filters, 'c', needsJoin ? 'ce' : undefined)];
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

  /**
   * Sentiment breakdown per employee, not just a raw count -- powers the
   * stacked "Top employees by enquiries" bar so each employee's outcomes
   * (interested / needs follow-up / not interested / not yet extracted) are
   * visible at a glance, not just volume. The extraction join is now always
   * needed for this breakdown, unlike other raw-SQL reports here that only
   * join it when a filter requires it.
   */
  async topEmployees(limit = 10, filters: QueryReportsDto = {}) {
    const conditions = [Prisma.sql`c.employee_id IS NOT NULL`, ...this.buildCallConditions(filters, 'c', 'ce')];

    const rows = await this.prisma.$queryRaw<
      Array<{ name: string; count: bigint; interested: bigint; needs_follow_up: bigint; not_interested: bigint; unknown: bigint }>
    >(Prisma.sql`
      SELECT
        e.name,
        COUNT(*)::bigint AS count,
        COUNT(*) FILTER (WHERE ce.sentiment = 'interested')::bigint AS interested,
        COUNT(*) FILTER (WHERE ce.sentiment = 'needs_follow_up')::bigint AS needs_follow_up,
        COUNT(*) FILTER (WHERE ce.sentiment = 'not_interested')::bigint AS not_interested,
        COUNT(*) FILTER (WHERE ce.sentiment IS NULL)::bigint AS unknown
      FROM calls c
      JOIN employees e ON e.id = c.employee_id
      LEFT JOIN call_extractions ce ON ce.call_id = c.id
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY e.id, e.name
      ORDER BY count DESC
      LIMIT ${limit};
    `);
    return rows.map((r) => ({
      name: r.name,
      count: Number(r.count),
      interested: Number(r.interested),
      needsFollowUp: Number(r.needs_follow_up),
      notInterested: Number(r.not_interested),
      unknown: Number(r.unknown),
    }));
  }

  /**
   * Tracked from the point the branch field was introduced onward -- older
   * calls have no branch set and are deliberately excluded here rather than
   * counted as an "unknown" bucket, since that would understate how
   * complete the data actually is going forward.
   */
  /**
   * Sentiment breakdown per branch, same reasoning as topEmployees() --
   * powers the stacked "Calls by branch" bar so each branch's outcome mix
   * is visible, not just call volume.
   */
  async byBranch(filters: QueryReportsDto = {}) {
    const conditions = [Prisma.sql`c.branch IS NOT NULL`, ...this.buildCallConditions(filters, 'c', 'ce')];

    const rows = await this.prisma.$queryRaw<
      Array<{ branch: string; count: bigint; interested: bigint; needs_follow_up: bigint; not_interested: bigint; unknown: bigint }>
    >(Prisma.sql`
      SELECT
        c.branch::text AS branch,
        COUNT(*)::bigint AS count,
        COUNT(*) FILTER (WHERE ce.sentiment = 'interested')::bigint AS interested,
        COUNT(*) FILTER (WHERE ce.sentiment = 'needs_follow_up')::bigint AS needs_follow_up,
        COUNT(*) FILTER (WHERE ce.sentiment = 'not_interested')::bigint AS not_interested,
        COUNT(*) FILTER (WHERE ce.sentiment IS NULL)::bigint AS unknown
      FROM calls c
      LEFT JOIN call_extractions ce ON ce.call_id = c.id
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY c.branch
      ORDER BY count DESC;
    `);
    return rows.map((r) => ({
      branch: r.branch,
      count: Number(r.count),
      interested: Number(r.interested),
      needsFollowUp: Number(r.needs_follow_up),
      notInterested: Number(r.not_interested),
      unknown: Number(r.unknown),
    }));
  }

  /**
   * One row per customer, aggregated from whichever calls match the current
   * report filters -- call count, most recent call, latest vehicle, and
   * total stated budget are all scoped to that filtered set, not the
   * customer's entire history, so this stays consistent with every other
   * widget on the Reports page.
   */
  async customerCallHistory(filters: QueryReportsDto = {}, page = 1, pageSize = 20) {
    const conditions = [Prisma.sql`c.customer_id IS NOT NULL`, ...this.buildCallConditions(filters, 'c', 'ce')];
    const whereSql = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const [rows, totalRows] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          customer_id: string;
          name: string | null;
          phone_number: string;
          call_count: bigint;
          last_call_date: Date;
          total_budget: unknown;
          latest_car_make: string | null;
          latest_car_model: string | null;
        }>
      >(Prisma.sql`
        SELECT
          cu.id AS customer_id,
          cu.name,
          cu.phone_number,
          COUNT(*)::bigint AS call_count,
          MAX(c.call_date) AS last_call_date,
          COALESCE(SUM(ce.budget), 0) AS total_budget,
          (array_agg(ce.car_make ORDER BY c.call_date DESC) FILTER (WHERE ce.car_make IS NOT NULL AND ce.car_make != ''))[1] AS latest_car_make,
          (array_agg(ce.car_model ORDER BY c.call_date DESC) FILTER (WHERE ce.car_model IS NOT NULL AND ce.car_model != ''))[1] AS latest_car_model
        FROM calls c
        JOIN customers cu ON cu.id = c.customer_id
        LEFT JOIN call_extractions ce ON ce.call_id = c.id
        ${whereSql}
        GROUP BY cu.id, cu.name, cu.phone_number
        ORDER BY call_count DESC, last_call_date DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize};
      `),
      this.prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        SELECT COUNT(DISTINCT c.customer_id)::bigint AS total
        FROM calls c
        LEFT JOIN call_extractions ce ON ce.call_id = c.id
        ${whereSql};
      `),
    ]);

    return {
      items: rows.map((r) => ({
        customerId: r.customer_id,
        name: r.name,
        phoneNumber: r.phone_number,
        callCount: Number(r.call_count),
        lastCallDate: r.last_call_date,
        totalBudget: Number(r.total_budget),
        latestCarMake: r.latest_car_make,
        latestCarModel: r.latest_car_model,
      })),
      total: Number(totalRows[0]?.total ?? 0),
      page,
      pageSize,
    };
  }
}
