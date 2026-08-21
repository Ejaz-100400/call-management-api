import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCoverageDto } from './dto/create-coverage.dto';
import { UpdateCoverageDto } from './dto/update-coverage.dto';

@Injectable()
export class CoverageService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.numberCoverage.findMany({
      include: { employee: true },
      orderBy: [{ phoneNumber: 'asc' }, { isBackup: 'asc' }, { startHour: 'asc' }],
    });
  }

  create(dto: CreateCoverageDto) {
    return this.prisma.numberCoverage.create({
      data: {
        phoneNumber: dto.phoneNumber,
        employeeId: dto.employeeId,
        startHour: dto.startHour ?? null,
        endHour: dto.endHour ?? null,
        isBackup: dto.isBackup ?? false,
      },
      include: { employee: true },
    });
  }

  async update(id: string, dto: UpdateCoverageDto) {
    const existing = await this.prisma.numberCoverage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Coverage row ${id} not found`);

    return this.prisma.numberCoverage.update({
      where: { id },
      data: {
        phoneNumber: dto.phoneNumber,
        employeeId: dto.employeeId,
        startHour: dto.startHour,
        endHour: dto.endHour,
        isBackup: dto.isBackup,
      },
      include: { employee: true },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.numberCoverage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Coverage row ${id} not found`);
    await this.prisma.numberCoverage.delete({ where: { id } });
    return { deleted: true };
  }
}
