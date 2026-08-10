import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { endOfDayIST, startOfDayIST } from '../common/timezone.util';
import { defaultFollowUpDueDate } from '../follow-ups/follow-up.util';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { getSignedRecordingUrl } from '../worker/providers/storage.provider';
import { QueryCallsDto } from './dto/query-calls.dto';
import { UpdateCallDto } from './dto/update-call.dto';
import { UpdateExtractionDto } from './dto/update-extraction.dto';

@Injectable()
export class CallsService {
  constructor(
    private prisma: PrismaService,
    private queue: QueueService,
  ) {}

  async findAll(query: QueryCallsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // Every extraction-scoped filter has to land on the same `extraction` key --
    // spreading multiple `{ extraction: {...} }` objects into `where` would have
    // each one silently clobber the last, since object spread doesn't merge
    // nested keys.
    const extractionFilter: Prisma.CallExtractionWhereInput = {
      ...(query.carMake && { carMake: { contains: query.carMake, mode: 'insensitive' } }),
      ...(query.carModel && { carModel: { contains: query.carModel, mode: 'insensitive' } }),
      ...(query.sentiment && { sentiment: query.sentiment }),
      ...(query.followUpRequired !== undefined && { followUpRequired: query.followUpRequired === 'true' }),
    };

    const where: Prisma.CallWhereInput = {
      ...(query.category && { businessCategory: query.category }),
      ...(query.employeeId && { employeeId: query.employeeId }),
      ...((query.dateFrom || query.dateTo) && {
        callDate: {
          ...(query.dateFrom && { gte: startOfDayIST(query.dateFrom) }),
          ...(query.dateTo && { lt: endOfDayIST(query.dateTo) }),
        },
      }),
      ...(query.phone && {
        customer: { phoneNumber: { contains: query.phone } },
      }),
      ...(Object.keys(extractionFilter).length > 0 && { extraction: extractionFilter }),
      ...(query.search && {
        OR: [
          { customer: { name: { contains: query.search, mode: 'insensitive' } } },
          { extraction: { summary: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.call.findMany({
        where,
        include: { customer: true, employee: true, extraction: true, importedBy: { select: { name: true, email: true } } },
        orderBy: { callDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.call.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const call = await this.prisma.call.findUnique({
      where: { id },
      include: {
        customer: true,
        employee: true,
        extraction: true,
        transcript: true,
        products: { include: { product: true } },
        importedBy: { select: { name: true, email: true } },
      },
    });
    if (!call) throw new NotFoundException(`Call ${id} not found`);
    return call;
  }

  async updateExtraction(callId: string, dto: UpdateExtractionDto, editedById: string) {
    const existing = await this.prisma.callExtraction.findUnique({ where: { callId } });
    if (!existing) throw new NotFoundException(`No extraction found for call ${callId}`);

    const updated = await this.prisma.callExtraction.update({
      where: { callId },
      data: {
        customerName: dto.customerName,
        carMake: dto.carMake,
        carModel: dto.carModel,
        carVariant: dto.carVariant,
        location: dto.location,
        customerRequirements: dto.customerRequirements,
        budget: dto.budget,
        followUpRequired: dto.followUpRequired,
        followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : undefined,
        summary: dto.summary,
        sentiment: dto.sentiment,
        editedBy: editedById,
        editedAt: new Date(),
      },
    });

    // The Follow-ups page reads from the separate FollowUp table, not this
    // flag directly -- keep the two in sync whenever the flag/date changes,
    // the same way the live pipeline and historical import already do.
    if (dto.followUpRequired !== undefined || dto.followUpDate !== undefined) {
      await this.syncFollowUp(callId, updated.followUpRequired, updated.followUpDate);
    }

    await this.prisma.auditLog.create({
      data: {
        userId: editedById,
        action: 'edit_extraction',
        entity: 'call_extractions',
        entityId: updated.id,
        details: dto as Prisma.InputJsonValue,
      },
    });

    return updated;
  }

  private async syncFollowUp(callId: string, followUpRequired: boolean, followUpDate: Date | null) {
    const existingFollowUp = await this.prisma.followUp.findFirst({ where: { callId } });

    if (followUpRequired) {
      // No specific date given -- default rather than silently never
      // creating the task, which is invisible on the Follow-ups page.
      const dueDate = followUpDate ?? defaultFollowUpDueDate();
      if (existingFollowUp) {
        if (existingFollowUp.dueDate.getTime() !== dueDate.getTime()) {
          await this.prisma.followUp.update({ where: { id: existingFollowUp.id }, data: { dueDate } });
        }
      } else {
        const call = await this.prisma.call.findUnique({ where: { id: callId }, select: { employeeId: true } });
        await this.prisma.followUp.create({
          data: { callId, dueDate, assignedTo: call?.employeeId },
        });
      }
    } else if (existingFollowUp && existingFollowUp.status === 'pending') {
      // Follow-up was unflagged before anyone acted on it -- remove it rather
      // than leaving a stale pending task with no due date to work from.
      await this.prisma.followUp.delete({ where: { id: existingFollowUp.id } });
    }
  }

  async updateCall(id: string, dto: UpdateCallDto, editedById: string) {
    await this.findOne(id);

    const updated = await this.prisma.call.update({
      where: { id },
      data: {
        businessCategory: dto.businessCategory,
        callDate: dto.callDate ? new Date(dto.callDate) : undefined,
        employeeId: dto.employeeId !== undefined ? dto.employeeId || null : undefined,
      },
      include: { customer: true, employee: true, extraction: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: editedById,
        action: 'edit_call',
        entity: 'calls',
        entityId: id,
        details: dto as Prisma.InputJsonValue,
      },
    });

    return updated;
  }

  async remove(id: string, deletedById: string) {
    const call = await this.findOne(id);
    await this.prisma.call.delete({ where: { id } });

    await this.prisma.auditLog.create({
      data: {
        userId: deletedById,
        action: 'delete_call',
        entity: 'calls',
        entityId: id,
        details: {
          callDate: call.callDate.toISOString()
        },
      },
    });

    return { deleted: true };
  }

  /**
   * Bulk counterpart to remove() -- silently ignores any ids that don't
   * exist (already deleted, or a stale selection from a page that's since
   * changed) rather than failing the whole batch over it.
   */
  async removeMany(ids: string[], deletedById: string) {
    const calls = await this.prisma.call.findMany({ where: { id: { in: ids } }, select: { id: true, callDate: true } });
    if (calls.length === 0) return { deleted: 0 };

    await this.prisma.$transaction([
      this.prisma.call.deleteMany({ where: { id: { in: calls.map((c) => c.id) } } }),
      this.prisma.auditLog.createMany({
        data: calls.map((c) => ({
          userId: deletedById,
          action: 'delete_call',
          entity: 'calls',
          entityId: c.id,
          details: { callDate: c.callDate.toISOString() },
        })),
      }),
    ]);

    return { deleted: calls.length };
  }

  /**
   * Calls sharing the same customer, the exact same call_date, AND the same
   * extracted vehicle -- the signature of an import row (Excel or photo-scan)
   * that got processed twice, e.g. the same photo uploaded in two batches.
   * Customer + date alone isn't enough: a customer can genuinely have two
   * different real enquiries land on the same (often defaulted) date, and
   * requiring the same car_make/car_model as well is what tells those apart
   * from an actual re-import -- confirmed against production data, where
   * customer+date alone flagged 16 "duplicate" groups but most were two
   * different cars for the same customer; adding vehicle brought it down to
   * the 3 that were genuinely identical rows. NULL make/model still groups
   * together correctly since GROUP BY treats NULLs as equal to each other.
   */
  async findDuplicates() {
    const groups = await this.prisma.$queryRaw<
      Array<{ customer_id: string; call_date: Date; car_make: string | null; car_model: string | null; call_ids: string[] }>
    >`
      SELECT c.customer_id, c.call_date, ce.car_make, ce.car_model, array_agg(c.id ORDER BY c.created_at) AS call_ids
      FROM calls c
      LEFT JOIN call_extractions ce ON ce.call_id = c.id
      WHERE c.customer_id IS NOT NULL
      GROUP BY c.customer_id, c.call_date, ce.car_make, ce.car_model
      HAVING COUNT(*) > 1
      ORDER BY c.call_date DESC
      LIMIT 50;
    `;
    if (groups.length === 0) return [];

    const calls = await this.prisma.call.findMany({
      where: { id: { in: groups.flatMap((g) => g.call_ids) } },
      include: { customer: true, employee: true, extraction: true },
    });
    const callsById = new Map(calls.map((c) => [c.id, c]));

    return groups.map((g) => {
      const first = callsById.get(g.call_ids[0]);
      return {
        customerId: g.customer_id,
        customerName: first?.customer?.name ?? null,
        customerPhone: first?.customer?.phoneNumber ?? null,
        callDate: g.call_date,
        calls: g.call_ids
          .map((id) => callsById.get(id))
          .filter((c): c is NonNullable<typeof c> => c != null)
          .map((c) => ({
            id: c.id,
            businessCategory: c.businessCategory,
            carMake: c.extraction?.carMake ?? null,
            carModel: c.extraction?.carModel ?? null,
            employeeName: c.employee?.name ?? null,
            status: c.status,
            summary: c.extraction?.summary ?? null,
            imported: c.extraction?.extractedByModel === 'manual_import',
            createdAt: c.createdAt,
          })),
      };
    });
  }

  /** Populates the Car Make filter dropdown -- every distinct value actually on record. */
  async distinctCarMakes(): Promise<string[]> {
    const rows = await this.prisma.callExtraction.findMany({
      where: { carMake: { not: null } },
      distinct: ['carMake'],
      select: { carMake: true },
      orderBy: { carMake: 'asc' },
    });
    return rows.map((r) => r.carMake!).filter((make) => make.trim() !== '');
  }

  /**
   * Populates the Car Model filter dropdown. Scoped to a make when one's
   * already selected, so the list doesn't offer models that can't match --
   * otherwise every model on record.
   */
  async distinctCarModels(carMake?: string): Promise<string[]> {
    const rows = await this.prisma.callExtraction.findMany({
      where: { carModel: { not: null }, ...(carMake && { carMake }) },
      distinct: ['carModel'],
      select: { carModel: true },
      orderBy: { carModel: 'asc' },
    });
    return rows.map((r) => r.carModel!).filter((model) => model.trim() !== '');
  }

  async getRecordingUrl(id: string) {
    const call = await this.findOne(id);
    if (!call.recordingStorageKey) {
      throw new NotFoundException('No recording available for this call');
    }

    const expiresInSeconds = 600;
    const url = await getSignedRecordingUrl(call.recordingStorageKey, expiresInSeconds);
    return { url, expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString() };
  }

  /**
   * Re-runs transcription + AI extraction from scratch. Doesn't do the work
   * itself -- just resets status and enqueues a job for the worker to pick up.
   * If this call already has a recording in object storage, the worker
   * re-uses it rather than re-fetching from the telephony provider (whose
   * temporary recording URL has likely expired by now anyway).
   */
  async reprocess(id: string) {
    await this.findOne(id);
    await this.prisma.call.update({
      where: { id },
      data: { status: 'pending', failureReason: null },
    });
    await this.queue.enqueueCallProcessing({ type: 'full_reprocess', callId: id });
    return { enqueued: true, callId: id };
  }

  async getProcessingStatus(id: string) {
    const call = await this.prisma.call.findUnique({
      where: { id },
      select: { id: true, status: true, failureReason: true, updatedAt: true },
    });
    if (!call) throw new NotFoundException(`Call ${id} not found`);
    return call;
  }

  /**
   * Narrower than reprocess() -- re-runs only the summarization/sentiment
   * step against the already-existing transcript, for when the transcript
   * itself was fine but the AI's read of it needs another pass.
   */
  async regenerateSummary(id: string) {
    const call = await this.findOne(id);
    if (!call.transcript) {
      throw new NotFoundException('No transcript yet for this call -- use reprocess() instead');
    }
    await this.queue.enqueueCallProcessing({ type: 'regenerate_summary', callId: id });
    return { enqueued: true, callId: id };
  }
}
