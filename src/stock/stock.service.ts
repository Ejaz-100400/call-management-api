import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Branch, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStockItemDto } from './dto/create-stock-item.dto';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { QueryStockItemsDto } from './dto/query-stock-items.dto';
import { QueryStockMovementsDto } from './dto/query-stock-movements.dto';
import { UpdateStockItemDto } from './dto/update-stock-item.dto';

const ALL_BRANCHES: Branch[] = ['ambattur', 'kattankulathur', 'sithalapakkam', 'pondicherry'];

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  // Current on-hand quantity is never stored -- it's the sum of `in`
  // movements minus `out` movements for that item/branch, computed here on
  // every read. At this business's volume that's cheap, and it avoids ever
  // having a cached number drift from the movement log that's the actual
  // source of truth.
  private async quantitiesByItem(stockItemIds: string[]): Promise<Map<string, Map<Branch, number>>> {
    if (stockItemIds.length === 0) return new Map();
    const sums = await this.prisma.stockMovement.groupBy({
      by: ['stockItemId', 'branch', 'type'],
      where: { stockItemId: { in: stockItemIds } },
      _sum: { quantity: true },
    });
    const result = new Map<string, Map<Branch, number>>();
    for (const id of stockItemIds) {
      result.set(id, new Map(ALL_BRANCHES.map((b) => [b, 0])));
    }
    for (const row of sums) {
      const branchMap = result.get(row.stockItemId)!;
      const signed = (row._sum.quantity ?? 0) * (row.type === 'in' ? 1 : -1);
      branchMap.set(row.branch, (branchMap.get(row.branch) ?? 0) + signed);
    }
    return result;
  }

  private async quantityFor(stockItemId: string, branch: Branch): Promise<number> {
    const map = await this.quantitiesByItem([stockItemId]);
    return map.get(stockItemId)?.get(branch) ?? 0;
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
      const branchMap = quantities.get(item.id) ?? new Map();
      return {
        ...item,
        quantities: ALL_BRANCHES.map((branch) => {
          const quantity = branchMap.get(branch) ?? 0;
          return { branch, quantity, lowStock: item.reorderThreshold > 0 && quantity < item.reorderThreshold };
        }),
      };
    });
  }

  async createItem(dto: CreateStockItemDto, userId: string) {
    const item = await this.prisma.stockItem.create({
      data: { name: dto.name, category: dto.category, unit: dto.unit || 'pcs', reorderThreshold: dto.reorderThreshold ?? 0, active: dto.active ?? true },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'create_stock_item', entity: 'stock_items', entityId: item.id, details: { ...dto } as Prisma.InputJsonValue },
    });
    return item;
  }

  async updateItem(id: string, dto: UpdateStockItemDto, userId: string) {
    const existing = await this.prisma.stockItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Stock item ${id} not found`);
    const item = await this.prisma.stockItem.update({ where: { id }, data: dto });
    await this.prisma.auditLog.create({
      data: { userId, action: 'update_stock_item', entity: 'stock_items', entityId: id, details: dto as Prisma.InputJsonValue },
    });
    return item;
  }

  async findAllMovements(query: QueryStockMovementsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.StockMovementWhereInput = {
      ...(query.stockItemId && { stockItemId: query.stockItemId }),
      ...(query.branch?.length && { branch: { in: query.branch } }),
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
      const current = await this.quantityFor(dto.stockItemId, dto.branch as Branch);
      if (dto.quantity > current) {
        throw new BadRequestException(`Only ${current} ${item.unit} of "${item.name}" in stock at this branch -- can't remove ${dto.quantity}.`);
      }
    }

    return this.prisma.stockMovement.create({
      data: {
        stockItemId: dto.stockItemId,
        branch: dto.branch,
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

  async overview(filters: { branch?: Branch[]; category?: ('car_glasses' | 'car_modifications')[] }) {
    const items = await this.prisma.stockItem.findMany({
      where: { active: true, ...(filters.category?.length && { category: { in: filters.category } }) },
    });
    const quantities = await this.quantitiesByItem(items.map((i) => i.id));
    const branches = filters.branch?.length ? filters.branch : ALL_BRANCHES;

    const lowStockEntries: { stockItemId: string; name: string; category: string; unit: string; branch: Branch; quantity: number; reorderThreshold: number }[] = [];
    const totalsByCategory = new Map<string, number>();

    for (const item of items) {
      const branchMap = quantities.get(item.id) ?? new Map();
      let itemTotal = totalsByCategory.get(item.category) ?? 0;
      for (const branch of branches) {
        const quantity = branchMap.get(branch) ?? 0;
        itemTotal += quantity;
        if (item.reorderThreshold > 0 && quantity < item.reorderThreshold) {
          lowStockEntries.push({
            stockItemId: item.id,
            name: item.name,
            category: item.category,
            unit: item.unit,
            branch,
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
