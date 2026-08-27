import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { endOfDayIST, startOfDayIST } from '../common/timezone.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEnquiryDto } from './dto/create-enquiry.dto';
import { QueryEnquiriesDto } from './dto/query-enquiries.dto';
import { UpdateEnquiryDto } from './dto/update-enquiry.dto';

@Injectable()
export class EnquiriesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryEnquiriesDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.InPersonEnquiryWhereInput = {
      ...(query.branch?.length && { branch: { in: query.branch } }),
      ...(query.outcome?.length && { outcome: { in: query.outcome } }),
      ...(query.phone && { customerPhone: { contains: query.phone } }),
      ...((query.dateFrom || query.dateTo) && {
        enquiryDate: {
          ...(query.dateFrom && { gte: startOfDayIST(query.dateFrom) }),
          ...(query.dateTo && { lt: endOfDayIST(query.dateTo) }),
        },
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.inPersonEnquiry.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phoneNumber: true } },
          employee: { select: { name: true } },
          enteredBy: { select: { name: true } },
        },
        orderBy: { enquiryDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.inPersonEnquiry.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async create(dto: CreateEnquiryDto, userId: string) {
    // A walk-in doesn't always give a phone number -- only find-or-create a
    // Customer when one was actually provided, same reasoning as the call
    // webhook's own findOrCreateCustomer.
    const customer = dto.customerPhone
      ? await this.prisma.customer.upsert({
          where: { phoneNumber: dto.customerPhone },
          create: { phoneNumber: dto.customerPhone },
          update: {},
        })
      : null;

    return this.prisma.inPersonEnquiry.create({
      data: {
        customerPhone: dto.customerPhone,
        customerId: customer?.id,
        customerName: dto.customerName,
        carMake: dto.carMake,
        carModel: dto.carModel,
        branch: dto.branch,
        enquiryDate: new Date(dto.enquiryDate),
        outcome: dto.outcome ?? 'undecided',
        notes: dto.notes,
        employeeId: dto.employeeId,
        enteredByUserId: userId,
      },
      include: { customer: true, employee: true },
    });
  }

  async update(id: string, dto: UpdateEnquiryDto) {
    const existing = await this.prisma.inPersonEnquiry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Enquiry ${id} not found`);

    // Only re-link the Customer when the phone actually changed.
    let customerId: string | null | undefined;
    if (dto.customerPhone !== undefined && dto.customerPhone !== existing.customerPhone) {
      if (dto.customerPhone) {
        const customer = await this.prisma.customer.upsert({
          where: { phoneNumber: dto.customerPhone },
          create: { phoneNumber: dto.customerPhone },
          update: {},
        });
        customerId = customer.id;
      } else {
        customerId = null;
      }
    }

    return this.prisma.inPersonEnquiry.update({
      where: { id },
      data: {
        customerPhone: dto.customerPhone,
        customerId,
        customerName: dto.customerName,
        carMake: dto.carMake,
        carModel: dto.carModel,
        branch: dto.branch,
        enquiryDate: dto.enquiryDate ? new Date(dto.enquiryDate) : undefined,
        outcome: dto.outcome,
        notes: dto.notes,
        employeeId: dto.employeeId,
      },
      include: { customer: true, employee: true, enteredBy: { select: { name: true } } },
    });
  }
}
