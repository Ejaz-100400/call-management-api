import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { getSignedRecordingUrl } from '../worker/providers/storage.provider';
import { QueryCallsDto } from './dto/query-calls.dto';
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

    const where: Prisma.CallWhereInput = {
      ...(query.category && { businessCategory: query.category }),
      ...(query.employeeId && { employeeId: query.employeeId }),
      ...((query.dateFrom || query.dateTo) && {
        callDate: {
          ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
          ...(query.dateTo && { lte: new Date(query.dateTo) }),
        },
      }),
      ...(query.phone && {
        customer: { phoneNumber: { contains: query.phone } },
      }),
      ...(query.carModel && {
        extraction: { carModel: { contains: query.carModel, mode: 'insensitive' } },
      }),
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
