import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BusinessCategory } from '@prisma/client';
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

  create(dto: CreateProductDto) {
    return this.prisma.product.create({ data: dto });
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    const usageCount = await this.prisma.callProduct.count({ where: { productId: id } });
    if (usageCount > 0) {
      throw new ConflictException(
        `This product is referenced by ${usageCount} call(s). Set active: false instead of deleting, so past reports stay accurate.`,
      );
    }
    await this.prisma.product.delete({ where: { id } });
    return { deleted: true };
  }
}
