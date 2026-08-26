import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockLocation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { STOCK_LOCATIONS } from './stock-location.util';
import { CreateStockItemDto } from './dto/create-stock-item.dto';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { QueryStockItemsDto } from './dto/query-stock-items.dto';
import { QueryStockMovementsDto } from './dto/query-stock-movements.dto';
import { UpdateStockItemDto } from './dto/update-stock-item.dto';

const ALL_LOCATIONS = STOCK_LOCATIONS as unknown as StockLocation[];

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  // Current on-hand quantity is never stored -- it's the sum of `in`
  // movements minus `out` movements for that item/location, computed here
  // on every read. At this business's volume that's cheap, and it avoids
  // ever having a cached number drift from the movement log that's the
  // actual source of truth.
  private async quantitiesByItem(stockItemIds: string[]): Promise<Map<string, Map<StockLocation, number>>> {
    if (stockItemIds.length === 0) return new Map();
    const sums = await this.prisma.stockMovement.groupBy({
      by: ['stockItemId', 'location', 'type'],
      where: { stockItemId: { in: stockItemIds } },
      _sum: { quantity: true },
    });
    const result = new Map<string, Map<StockLocation, number>>();
    for (const id of stockItemIds) {
      result.set(id, new Map(ALL_LOCATIONS.map((l) => [l, 0])));
    }
    for (const row of sums) {
      const locationMap = result.get(row.stockItemId)!;
      const signed = (row._sum.quantity ?? 0) * (row.type === 'in' ? 1 : -1);
      locationMap.set(row.location, (locationMap.get(row.location) ?? 0) + signed);
    }
    return result;
  }

  private async quantityFor(stockItemId: string, location: StockLocation): Promise<number> {
    const map = await this.quantitiesByItem([stockItemId]);
    return map.get(stockItemId)?.get(location) ?? 0;
  }

  async findAllItems(query: QueryStockItemsDto) {
    const where: Prisma.StockItemWhereInput = {
      ...(query.category?.length && { category: { in: query.category } }),
      ...(query.search && { name: { contains: query.search, mode: 'insensitive' } }),
      ...(query.active !== undefined && { active: query.active }),
    };

    const items = await this.prisma.stockItem.findMany({ where, orderBy: { name: 'asc' } });
    const quantities = await this.quantitiesByItem(items.map((i) => i.id));

    return items.map((item) => {
      const locationMap = quantities.get(item.id) ?? new Map();
      return {
        ...item,
        quantities: ALL_LOCATIONS.map((location) => {
          const quantity = locationMap.get(location) ?? 0;
          return { location, quantity, lowStock: item.reorderThreshold > 0 && quantity < item.reorderThreshold };
        }),
      };
    });
  }

  // productId is purely a subcategory link -- verify it exists (a friendlier
  // 404 than the raw FK violation) but never let it override the name/
  // category the user actually typed, since several distinctly-named items
  // (e.g. "Amy Tricolor Fog", "Osram H4") can share one catalog subcategory.
  private async assertProductExists(productId?: string) {
    if (!productId) return;
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException(`Product ${productId} not found`);
  }

  async createItem(dto: CreateStockItemDto, userId: string) {
    await this.assertProductExists(dto.productId);

    const item = await this.prisma.$transaction(async (tx) => {
      const created = await tx.stockItem.create({
        data: {
          name: dto.name,
          category: dto.category,
          productId: dto.productId,
          unit: dto.unit || 'pcs',
          reorderThreshold: dto.reorderThreshold ?? 0,
          active: dto.active ?? true,
        },
      });
      const initialEntries = (dto.initialStock ?? []).filter((e) => e.quantity > 0);
      if (initialEntries.length > 0) {
        await tx.stockMovement.createMany({
          data: initialEntries.map((entry) => ({
            stockItemId: created.id,
            location: entry.location,
            type: 'in' as const,
            quantity: entry.quantity,
            movementDate: new Date(),
            reason: 'Initial stock',
            enteredByUserId: userId,
          })),
        });
      }
      return created;
    });

    await this.prisma.auditLog.create({
      data: { userId, action: 'create_stock_item', entity: 'stock_items', entityId: item.id, details: { ...dto } as unknown as Prisma.InputJsonValue },
    });
    return item;
  }

  async updateItem(id: string, dto: UpdateStockItemDto, userId: string) {
    const existing = await this.prisma.stockItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Stock item ${id} not found`);

    if (dto.productId !== undefined) await this.assertProductExists(dto.productId);

    const data: Prisma.StockItemUpdateInput = {
      name: dto.name,
      category: dto.category,
      unit: dto.unit,
      reorderThreshold: dto.reorderThreshold,
      active: dto.active,
    };
    if (dto.productId !== undefined) {
      data.product = dto.productId ? { connect: { id: dto.productId } } : { disconnect: true };
    }

    const item = await this.prisma.stockItem.update({ where: { id }, data });
    await this.prisma.auditLog.create({
      data: { userId, action: 'update_stock_item', entity: 'stock_items', entityId: id, details: dto as Prisma.InputJsonValue },
    });
    return item;
  }

  async deleteItem(id: string, userId: string) {
    const item = await this.prisma.stockItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Stock item ${id} not found`);

    const movementCount = await this.prisma.stockMovement.count({ where: { stockItemId: id } });
    if (movementCount > 0) {
      throw new ConflictException(
        `"${item.name}" has ${movementCount} logged movement(s). Set it inactive instead of deleting, so the history stays intact.`,
      );
    }

    await this.prisma.stockItem.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: { userId, action: 'delete_stock_item', entity: 'stock_items', entityId: id, details: { name: item.name } as Prisma.InputJsonValue },
    });
    return { deleted: true };
  }

  async findAllMovements(query: QueryStockMovementsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.StockMovementWhereInput = {
      ...(query.stockItemId && { stockItemId: query.stockItemId }),
      ...(query.location?.length && { location: { in: query.location } }),
      ...(query.type?.length && { type: { in: query.type } }),
      ...(query.search && {
        OR: [
          { reason: { contains: query.search, mode: 'insensitive' } },
          { stockItem: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
      ...((query.dateFrom || query.dateTo) && {
        movementDate: {
          ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
          ...(query.dateTo && { lte: new Date(query.dateTo) }),
        },
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        include: { stockItem: { select: { id: true, name: true, category: true, unit: true } }, enteredBy: { select: { name: true } } },
        orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async createMovement(dto: CreateStockMovementDto, userId: string) {
    const item = await this.prisma.stockItem.findUnique({ where: { id: dto.stockItemId } });
    if (!item) throw new NotFoundException(`Stock item ${dto.stockItemId} not found`);

    if (dto.type === 'out') {
      const current = await this.quantityFor(dto.stockItemId, dto.location);
      if (dto.quantity > current) {
        throw new BadRequestException(`Only ${current} ${item.unit} of "${item.name}" in stock at this location -- can't remove ${dto.quantity}.`);
      }
    }

    return this.prisma.stockMovement.create({
      data: {
        stockItemId: dto.stockItemId,
        location: dto.location,
        type: dto.type,
        quantity: dto.quantity,
        movementDate: new Date(dto.movementDate),
        reason: dto.reason,
        notes: dto.notes,
        enteredByUserId: userId,
      },
      include: { stockItem: { select: { id: true, name: true, category: true, unit: true } }, enteredBy: { select: { name: true } } },
    });
  }

  async deleteMovement(id: string, userId: string) {
    const movement = await this.prisma.stockMovement.findUnique({ where: { id }, include: { stockItem: { select: { name: true, unit: true } } } });
    if (!movement) throw new NotFoundException(`Movement ${id} not found`);

    // Removing this movement changes the running total by whatever it
    // contributed -- reverse that to make sure the item/location wouldn't
    // end up negative, since other movements may have been logged since.
    const current = await this.quantityFor(movement.stockItemId, movement.location);
    const withoutThis = current - (movement.type === 'in' ? movement.quantity : -movement.quantity);
    if (withoutThis < 0) {
      throw new BadRequestException(
        `Can't delete this -- removing it would leave "${movement.stockItem.name}" at a negative quantity, since other movements were logged after it.`,
      );
    }

    await this.prisma.stockMovement.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'delete_stock_movement',
        entity: 'stock_movements',
        entityId: id,
        details: { stockItem: movement.stockItem.name, location: movement.location, type: movement.type, quantity: movement.quantity } as Prisma.InputJsonValue,
      },
    });
    return { deleted: true };
  }

  async overview(filters: { location?: StockLocation[]; category?: ('car_glasses' | 'car_modifications')[] }) {
    const items = await this.prisma.stockItem.findMany({
      where: { active: true, ...(filters.category?.length && { category: { in: filters.category } }) },
    });
    const quantities = await this.quantitiesByItem(items.map((i) => i.id));
    const locations = filters.location?.length ? filters.location : ALL_LOCATIONS;

    const lowStockEntries: { stockItemId: string; name: string; category: string; unit: string; location: StockLocation; quantity: number; reorderThreshold: number }[] = [];
    const totalsByCategory = new Map<string, number>();

    for (const item of items) {
      const locationMap = quantities.get(item.id) ?? new Map();
      let itemTotal = totalsByCategory.get(item.category) ?? 0;
      for (const location of locations) {
        const quantity = locationMap.get(location) ?? 0;
        itemTotal += quantity;
        if (item.reorderThreshold > 0 && quantity < item.reorderThreshold) {
          lowStockEntries.push({
            stockItemId: item.id,
            name: item.name,
            category: item.category,
            unit: item.unit,
            location,
            quantity,
            reorderThreshold: item.reorderThreshold,
          });
        }
      }
      totalsByCategory.set(item.category, itemTotal);
    }

    return {
      totalItems: items.length,
      lowStockCount: lowStockEntries.length,
      lowStockEntries: lowStockEntries.sort((a, b) => a.quantity - b.quantity),
      totalsByCategory: [...totalsByCategory.entries()].map(([category, total]) => ({ category, total })),
    };
  }
}
