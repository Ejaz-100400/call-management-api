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
      ...(query.carMake && { carMake: { contains: query.carMake, mode: 'insensitive' } }),
      ...(query.carModel && { carModel: { contains: query.carModel, mode: 'insensitive' } }),
    };
    const callFilter: Prisma.CallWhereInput = {
      ...(query.category && { businessCategory: query.category }),
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
   * Fuzzy duplicate detection using the pg_trgm similarity index already set
   * up in schema.sql. Exact phone-number matches aren't "duplicates" needing
   * review -- they're already the same customer by definition (phone_number
   * is unique) -- so this only surfaces name-similarity across DIFFERENT
   * customer rows, for a human to confirm before merging.
   */
  findDuplicates() {
    return this.prisma.$queryRaw<
      Array<{ id_a: string; name_a: string; id_b: string; name_b: string; similarity: number }>
    >`
      SELECT a.id AS id_a, a.name AS name_a, b.id AS id_b, b.name AS name_b,
             similarity(a.name, b.name) AS similarity
      FROM customers a
      JOIN customers b ON a.id < b.id
      WHERE a.name IS NOT NULL AND b.name IS NOT NULL
        AND similarity(a.name, b.name) > 0.4
      ORDER BY similarity DESC
      LIMIT 100;
    `;
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
