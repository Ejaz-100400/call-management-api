import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}

  findAll(active?: boolean) {
    return this.prisma.employee.findMany({
      where: active === undefined ? undefined : { active },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) throw new NotFoundException(`Employee ${id} not found`);
    return employee;
  }

  create(dto: CreateEmployeeDto) {
    return this.prisma.employee.create({ data: dto });
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    await this.findOne(id);
    return this.prisma.employee.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    const callCount = await this.prisma.call.count({ where: { employeeId: id } });
    if (callCount > 0) {
      throw new ConflictException(
        `This employee has ${callCount} associated call(s). Set active: false instead of deleting, to keep call history intact.`,
      );
    }
    await this.prisma.employee.delete({ where: { id } });
    return { deleted: true };
  }
}
