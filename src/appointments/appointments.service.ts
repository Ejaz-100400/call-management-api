import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { endOfDayIST, startOfDayIST } from '../common/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { QueryAppointmentsDto } from './dto/query-appointments.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';

// The site-wide alert fires once an appointment is within an hour, and
// keeps showing for a while after the booked time -- a customer who's
// running late is still "expected", and that's the window where staff need
// to know whether to keep the slot or mark a no-show.
const ALERT_LEAD_MS = 60 * 60_000;
const ALERT_GRACE_MS = 30 * 60_000;

const include = { products: { include: { product: { select: { id: true, name: true } } } } } satisfies Prisma.AppointmentInclude;
type AppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof include }>;

// Flattens the join rows so callers see `products: [{ id, name }]`.
function toView(a: AppointmentRow) {
  const { products, ...rest } = a;
  return { ...rest, products: products.map((p) => p.product) };
}

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryAppointmentsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.AppointmentWhereInput = {
      ...(query.status?.length && { status: { in: query.status } }),
      ...(query.branch?.length && { branch: { in: query.branch } }),
      ...(query.search && { customerName: { contains: query.search, mode: 'insensitive' } }),
      // appointmentAt is a real timestamp, so these are the IST day
      // boundaries (unlike the date-only Sale/Enquiry columns).
      ...((query.dateFrom || query.dateTo) && {
        appointmentAt: {
          ...(query.dateFrom && { gte: startOfDayIST(query.dateFrom) }),
          ...(query.dateTo && { lt: endOfDayIST(query.dateTo) }),
        },
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        include,
        orderBy: { appointmentAt: query.order ?? 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return { items: items.map(toView), total, page, pageSize };
  }

  /** Still-scheduled appointments inside the alert window -- drives the site-wide banner. */
  async upcoming() {
    const now = Date.now();
    const rows = await this.prisma.appointment.findMany({
      where: {
        status: 'scheduled',
        appointmentAt: { gte: new Date(now - ALERT_GRACE_MS), lte: new Date(now + ALERT_LEAD_MS) },
      },
      include,
      orderBy: { appointmentAt: 'asc' },
    });
    return rows.map(toView);
  }

  private async assertProductsExist(productIds: string[] | undefined) {
    if (!productIds?.length) return;
    const unique = [...new Set(productIds)];
    const found = await this.prisma.product.count({ where: { id: { in: unique } } });
    if (found !== unique.length) throw new BadRequestException('One or more selected light upgrades no longer exist.');
  }

  async create(dto: CreateAppointmentDto, userId: string) {
    await this.assertProductsExist(dto.productIds);
    const productIds = [...new Set(dto.productIds ?? [])];

    const created = await this.prisma.appointment.create({
      data: {
        customerName: dto.customerName.trim(),
        carMake: dto.carMake?.trim() || null,
        carModel: dto.carModel?.trim() || null,
        branch: dto.branch,
        source: dto.source ?? 'unknown',
        appointmentAt: new Date(dto.appointmentAt),
        createdByUserId: userId,
        products: { create: productIds.map((productId) => ({ productId })) },
      },
      include,
    });
    return toView(created);
  }

  async update(id: string, dto: UpdateAppointmentDto) {
    const existing = await this.prisma.appointment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Appointment ${id} not found`);
    await this.assertProductsExist(dto.productIds);

    const updated = await this.prisma.$transaction(async (tx) => {
      // The product list is replaced wholesale when sent -- it's a set the
      // form edits as a whole, not rows to patch individually.
      if (dto.productIds) {
        await tx.appointmentProduct.deleteMany({ where: { appointmentId: id } });
        await tx.appointmentProduct.createMany({
          data: [...new Set(dto.productIds)].map((productId) => ({ appointmentId: id, productId })),
        });
      }
      return tx.appointment.update({
        where: { id },
        data: {
          customerName: dto.customerName?.trim(),
          carMake: dto.carMake !== undefined ? dto.carMake.trim() || null : undefined,
          carModel: dto.carModel !== undefined ? dto.carModel.trim() || null : undefined,
          branch: dto.branch,
          source: dto.source,
          appointmentAt: dto.appointmentAt ? new Date(dto.appointmentAt) : undefined,
          status: dto.status,
        },
        include,
      });
    });
    return toView(updated);
  }

  async remove(id: string) {
    const existing = await this.prisma.appointment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Appointment ${id} not found`);
    await this.prisma.appointment.delete({ where: { id } });
    return { deleted: true };
  }
}
