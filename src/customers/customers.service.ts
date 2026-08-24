import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryCustomersDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // Car make/model/category live on a customer's calls, not on the customer
    // itself -- "matches" means at least one call satisfies all of them
    // together, so both conditions have to land in the same `some` clause
    // rather than two separate `calls: {...}` keys (which would clobber
    // each other, since object spread doesn't merge nested keys).
    const extractionFilter: Prisma.CallExtractionWhereInput = {
      ...(query.carMake?.length && { carMake: { in: query.carMake } }),
      ...(query.carModel?.length && { carModel: { in: query.carModel } }),
    };
    const callFilter: Prisma.CallWhereInput = {
      ...(query.category?.length && { businessCategory: { in: query.category } }),
      ...(query.status?.length && { status: { in: query.status } }),
      ...(query.productId?.length && { products: { some: { productId: { in: query.productId } } } }),
      ...(Object.keys(extractionFilter).length > 0 && { extraction: extractionFilter }),
    };

    const where: Prisma.CustomerWhereInput = {
      ...(query.phone && { phoneNumber: { contains: query.phone } }),
      ...(query.search && { name: { contains: query.search, mode: 'insensitive' } }),
      ...(Object.keys(callFilter).length > 0 && { calls: { some: callFilter } }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          calls: {
            orderBy: { callDate: 'desc' },
            take: 1,
            select: { extraction: { select: { carMake: true, carModel: true, carVariant: true } } },
          },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    // Flatten "most recent call's vehicle" onto each row for display -- a
    // customer can have several cars over time, but the list view only has
    // room for one, so show whichever call was most recent.
    const items = rows.map(({ calls, ...customer }) => ({
      ...customer,
      latestCarMake: calls[0]?.extraction?.carMake ?? null,
      latestCarModel: calls[0]?.extraction?.carModel ?? null,
      latestCarVariant: calls[0]?.extraction?.carVariant ?? null,
    }));

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException(`Customer ${id} not found`);
    return customer;
  }

  async findCalls(id: string) {
    await this.findOne(id);
    return this.prisma.call.findMany({
      where: { customerId: id },
      include: { extraction: true, employee: true },
      orderBy: { callDate: 'desc' },
    });
  }

  async update(id: string, dto: UpdateCustomerDto) {
    await this.findOne(id);
    return this.prisma.customer.update({ where: { id }, data: dto });
  }

  /**
   * Deleting a customer sets customer_id to NULL on their calls (the FK's
   * ON DELETE SET NULL, confirmed against the live schema) rather than
   * deleting the calls themselves -- their call history survives as
   * unassigned/"Unknown caller" rows instead of disappearing.
   */
  async removeMany(ids: string[]) {
    const result = await this.prisma.customer.deleteMany({ where: { id: { in: ids } } });
    return { deleted: result.count };
  }

  /**
   * Fuzzy duplicate detection using the pg_trgm similarity index already set
   * up in schema.sql. Exact phone-number matches aren't "duplicates" needing
   * review -- they're already the same customer by definition (phone_number
   * is unique) -- so this only surfaces name-similarity across DIFFERENT
   * customer rows, for a human to confirm before merging. Phone similarity
   * and each side's latest vehicle are included alongside name similarity so
   * the review step can show *why* a pair looks like a match, not just a
   * single blended score -- two different phone numbers with the same name
   * and the same car is a much stronger signal than name alone.
   */
  async findDuplicates() {
    const pairs = await this.prisma.$queryRaw<
      Array<{
        id_a: string;
        name_a: string;
        phone_a: string;
        id_b: string;
        name_b: string;
        phone_b: string;
        name_similarity: number;
        phone_similarity: number;
        car_make_a: string | null;
        car_model_a: string | null;
        car_make_b: string | null;
        car_model_b: string | null;
      }>
    >`
      SELECT a.id AS id_a, a.name AS name_a, a.phone_number AS phone_a,
             b.id AS id_b, b.name AS name_b, b.phone_number AS phone_b,
             similarity(a.name, b.name) AS name_similarity,
             similarity(a.phone_number, b.phone_number) AS phone_similarity,
             ca.car_make AS car_make_a, ca.car_model AS car_model_a,
             cb.car_make AS car_make_b, cb.car_model AS car_model_b
      FROM customers a
      JOIN customers b ON a.id < b.id
      LEFT JOIN LATERAL (
        SELECT ce.car_make, ce.car_model
        FROM calls c
        JOIN call_extractions ce ON ce.call_id = c.id
        WHERE c.customer_id = a.id
        ORDER BY c.call_date DESC
        LIMIT 1
      ) ca ON true
      LEFT JOIN LATERAL (
        SELECT ce.car_make, ce.car_model
        FROM calls c
        JOIN call_extractions ce ON ce.call_id = c.id
        WHERE c.customer_id = b.id
        ORDER BY c.call_date DESC
        LIMIT 1
      ) cb ON true
      WHERE a.name IS NOT NULL AND b.name IS NOT NULL
        AND similarity(a.name, b.name) > 0.4
      ORDER BY similarity(a.name, b.name) DESC
      LIMIT 100;
    `;
    if (pairs.length === 0) return [];

    const ids = Array.from(new Set(pairs.flatMap((p) => [p.id_a, p.id_b])));
    const counts = await this.prisma.call.groupBy({ by: ['customerId'], where: { customerId: { in: ids } }, _count: true });
    const callCountById = new Map(counts.map((c) => [c.customerId, c._count]));

    return pairs.map((p) => {
      const vehicleMatch =
        !!p.car_make_a &&
        !!p.car_model_a &&
        p.car_make_a.toLowerCase() === p.car_make_b?.toLowerCase() &&
        p.car_model_a.toLowerCase() === p.car_model_b?.toLowerCase();
      return {
        id_a: p.id_a,
        name_a: p.name_a,
        phone_a: p.phone_a,
        id_b: p.id_b,
        name_b: p.name_b,
        phone_b: p.phone_b,
        name_similarity: p.name_similarity,
        phone_similarity: p.phone_similarity,
        vehicle_match: vehicleMatch,
        vehicle_a: [p.car_make_a, p.car_model_a].filter(Boolean).join(' ') || null,
        vehicle_b: [p.car_make_b, p.car_model_b].filter(Boolean).join(' ') || null,
        call_count_a: callCountById.get(p.id_a) ?? 0,
        call_count_b: callCountById.get(p.id_b) ?? 0,
      };
    });
  }

  async merge(duplicateId: string, canonicalId: string) {
    if (duplicateId === canonicalId) {
      throw new BadRequestException('Cannot merge a customer into itself');
    }
    await this.findOne(duplicateId);
    await this.findOne(canonicalId);

    return this.prisma.$transaction(async (tx) => {
      await tx.call.updateMany({
        where: { customerId: duplicateId },
        data: { customerId: canonicalId },
      });
      await tx.customer.delete({ where: { id: duplicateId } });
      return tx.customer.findUnique({ where: { id: canonicalId } });
    });
  }
}
