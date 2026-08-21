import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { istHour } from '../common/timezone.util';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

/** Compares phone numbers by their last 10 digits, ignoring +91/0/spacing differences. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.slice(-10);
}

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

  /**
   * Auto-assigns the employee a call gets routed to, from the ExoPhone
   * number Exotel's Connect applet actually dialed (DialWhomNumber) --
   * always just a starting default, never final: the assignment stays
   * editable from the call/follow-up itself for the cases this can't get
   * right.
   *
   * Reads the NumberCoverage table (see schema.prisma / the Team Coverage
   * page) rather than guessing from Employee.phone/role -- a shared number
   * can have several coverage rows across different hour windows (and
   * possibly different employees than whoever's own personal phone that
   * number happens to be), so this is the single source of truth for "who's
   * on this number right now." isBackup rows are informational only and are
   * never auto-assigned. If the matching hour falls in a gap between
   * windows, or more than one non-backup row matches, this returns null
   * rather than guessing.
   */
  async resolveForCall(dialedNumber: string, callDate: Date): Promise<string | null> {
    const target = normalizePhone(dialedNumber);
    if (!target) return null;

    const rows = await this.prisma.numberCoverage.findMany({
      where: { isBackup: false },
      include: { employee: { select: { id: true, active: true } } },
    });
    const candidates = rows.filter((r) => normalizePhone(r.phoneNumber) === target && r.employee.active);
    if (candidates.length === 0) return null;

    const hour = istHour(callDate);
    const inWindow = (start: number | null, end: number | null) => {
      if (start === null || end === null) return true; // no restriction -- always on
      return start <= end ? hour >= start && hour < end : hour >= start || hour < end; // wraps past midnight
    };
    const matches = candidates.filter((c) => inWindow(c.startHour, c.endHour));
    return matches.length === 1 ? matches[0].employeeId : null;
  }
}
