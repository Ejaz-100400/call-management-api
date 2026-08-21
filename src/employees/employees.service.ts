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
   * right (staff swapping who covers a shared number, etc).
   *
   * More than one active employee can share the same phone (e.g. two people
   * covering the same line at different times of day) -- when that happens,
   * this picks between them using the existing `role` field rather than
   * creation order (which has no relation to who actually works which
   * shift -- confirmed against real data where the backup employee's record
   * was created first). Whoever's role reads as a backup/relief role is
   * treated as the after-6pm IST employee; everyone else is the daytime
   * default. If no candidate's role signals "backup", this is genuinely
   * ambiguous and the call is left unassigned rather than guessing.
   */
  async resolveForCall(dialedNumber: string, callDate: Date): Promise<string | null> {
    const target = normalizePhone(dialedNumber);
    if (!target) return null;

    const active = await this.prisma.employee.findMany({
      where: { active: true, phone: { not: null } },
      select: { id: true, phone: true, role: true },
    });
    const candidates = active.filter((e) => normalizePhone(e.phone!) === target);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].id;

    const isBackupRole = (role: string | null) => /backup|relief|night|evening/i.test(role ?? '');
    const backup = candidates.find((e) => isBackupRole(e.role));
    const primary = candidates.find((e) => !isBackupRole(e.role));
    if (!backup || !primary) return null; // no clear day/night split among candidates -- don't guess

    const isEvening = istHour(callDate) >= 18;
    return isEvening ? backup.id : primary.id;
  }
}
