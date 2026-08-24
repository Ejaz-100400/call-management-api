import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BusinessCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  findAll(category?: BusinessCategory) {
    return this.prisma.product.findMany({
      where: category ? { category } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  /** Who added/edited this product and when -- entries only exist from when this logging was added, so older products only show their createdAt baseline (see the frontend's fallback for that). */
  history(id: string) {
    return this.prisma.auditLog.findMany({
      where: { entity: 'products', entityId: id },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true, email: true } } },
    });
  }

  async create(dto: CreateProductDto, userId: string) {
    const product = await this.prisma.product.create({ data: dto });
    await this.prisma.auditLog.create({
      data: { userId, action: 'create_product', entity: 'products', entityId: product.id, details: { ...dto } as Prisma.InputJsonValue },
    });
    return product;
  }

  async update(id: string, dto: UpdateProductDto, userId: string) {
    await this.findOne(id);
    const product = await this.prisma.product.update({ where: { id }, data: dto });
    await this.prisma.auditLog.create({
      data: { userId, action: 'update_product', entity: 'products', entityId: id, details: dto as Prisma.InputJsonValue },
    });
    return product;
  }

  async remove(id: string, userId: string) {
    const product = await this.findOne(id);
    const usageCount = await this.prisma.callProduct.count({ where: { productId: id } });
    if (usageCount > 0) {
      throw new ConflictException(
        `This product is referenced by ${usageCount} call(s). Set active: false instead of deleting, so past reports stay accurate.`,
      );
    }
    await this.prisma.product.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: { userId, action: 'delete_product', entity: 'products', entityId: id, details: { name: product.name } as Prisma.InputJsonValue },
    });
    return { deleted: true };
  }
}
