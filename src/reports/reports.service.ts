import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const [totalCalls, carGlasses, carMods, followUpsPending] = await Promise.all([
      this.prisma.call.count(),
      this.prisma.call.count({ where: { businessCategory: 'car_glasses' } }),
      this.prisma.call.count({ where: { businessCategory: 'car_modifications' } }),
      this.prisma.followUp.count({ where: { status: 'pending' } }),
    ]);

    return {
      totalCalls,
      totalEnquiries: totalCalls, // every recorded call is an enquiry in this business model
      carGlassesEnquiries: carGlasses,
      carModificationEnquiries: carMods,
      followUpsPending,
    };
  }

  async callsByPeriod(granularity: 'daily' | 'weekly' | 'monthly' = 'daily') {
    // `granularity` is constrained to this exact switch (not raw user input),
    // so it's safe to interpolate into date_trunc's first argument.
    const trunc = granularity === 'monthly' ? 'month' : granularity === 'weekly' ? 'week' : 'day';

    const rows = await this.prisma.$queryRawUnsafe<Array<{ period: Date; count: bigint }>>(
      `SELECT date_trunc('${trunc}', call_date) AS period, COUNT(*)::bigint AS count
       FROM calls
       GROUP BY period
       ORDER BY period DESC
       LIMIT 90;`,
    );
    // Postgres COUNT(*) comes back as a native bigint, which JSON.stringify
    // can't serialize -- narrow it to a number before it reaches the client.
    return rows.map((r) => ({ period: r.period, count: Number(r.count) }));
  }

  async followUpBreakdown() {
    const grouped = await this.prisma.followUp.groupBy({
      by: ['status'],
      _count: true,
    });
    return grouped.map((g) => ({ status: g.status, count: g._count }));
  }

  async topCarModels(limit = 10) {
    const rows = await this.prisma.$queryRaw<Array<{ car_model: string; count: bigint }>>`
      SELECT car_model, COUNT(*)::bigint AS count
      FROM call_extractions
      WHERE car_model IS NOT NULL AND car_model <> ''
      GROUP BY car_model
      ORDER BY count DESC
      LIMIT ${limit};
    `;
    return rows.map((r) => ({ car_model: r.car_model, count: Number(r.count) }));
  }

  async topProducts(limit = 10) {
    const rows = await this.prisma.$queryRaw<Array<{ name: string; category: string; count: bigint }>>`
      SELECT p.name, p.category, COUNT(*)::bigint AS count
      FROM call_products cp
      JOIN products p ON p.id = cp.product_id
      GROUP BY p.id, p.name, p.category
      ORDER BY count DESC
      LIMIT ${limit};
    `;
    return rows.map((r) => ({ name: r.name, category: r.category, count: Number(r.count) }));
  }
}
