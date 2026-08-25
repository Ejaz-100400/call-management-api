import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { linkDiscussedProducts } from '../common/product-matching.util';
import { endOfDayIST, parseIstTimestamp, startOfDayIST } from '../common/timezone.util';
import { defaultFollowUpDueDate, withFollowUpConsistency } from '../follow-ups/follow-up.util';
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
      ...(query.carMake?.length && { carMake: { in: query.carMake } }),
      ...(query.carModel?.length && { carModel: { in: query.carModel } }),
      ...(query.sentiment?.length && { sentiment: { in: query.sentiment } }),
      ...(query.followUpRequired !== undefined && { followUpRequired: query.followUpRequired === 'true' }),
    };

    const where: Prisma.CallWhereInput = {
      ...(query.category?.length && { businessCategory: { in: query.category } }),
      ...(query.status?.length && { status: { in: query.status } }),
      ...(query.employeeId?.length && { employeeId: { in: query.employeeId } }),
      ...(query.branch?.length && { branch: { in: query.branch } }),
      ...(query.channel?.length && { channel: { in: query.channel } }),
      ...(query.productId?.length && { products: { some: { productId: { in: query.productId } } } }),
      ...((query.dateFrom || query.dateTo) && {
        callDate: {
          ...(query.dateFrom && {
            gte: query.timeFrom
              ? (parseIstTimestamp(`${query.dateFrom} ${query.timeFrom}:00`) ?? startOfDayIST(query.dateFrom))
              : startOfDayIST(query.dateFrom),
          }),
          ...(query.dateTo && {
            [query.timeTo ? 'lte' : 'lt']: query.timeTo
              ? (parseIstTimestamp(`${query.dateTo} ${query.timeTo}:00`) ?? endOfDayIST(query.dateTo))
              : endOfDayIST(query.dateTo),
          }),
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
        include: {
          customer: true,
          employee: true,
          extraction: true,
          importedBy: { select: { name: true, email: true } },
          products: { include: { product: true } },
        },
        orderBy: { callDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.call.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /**
   * A failed call stays on the Missed Calls page for a full day regardless
   * of whether the customer was later reached on some other call -- a
   * missed call is a real event that happened and stays worth showing, not
   * something a later success should quietly erase. Only the 24h age cutoff
   * removes it.
   */
  async findMissed(page = 1, pageSize = 25) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const where: Prisma.CallWhereInput = {
      direction: 'inbound',
      status: 'failed',
      callDate: { gte: cutoff },
      customerId: { not: null },
    };

    const [items, total] = await Promise.all([
      this.prisma.call.findMany({
        where,
        include: { customer: true, employee: true },
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
    const call = await this.prisma.call.findUnique({ where: { id: callId }, select: { businessCategory: true, customerId: true } });
    if (!call) throw new NotFoundException(`Call ${callId} not found`);

    // This is a PATCH -- a field the caller didn't send should keep whatever
    // was already there, which is what the existing row's value (rather than
    // dto's undefined) falls back to below for the follow-up consistency check.
    const existing = await this.prisma.callExtraction.findUnique({ where: { callId } });
    const sentiment = dto.sentiment !== undefined ? dto.sentiment : existing?.sentiment;
    const followUpRequired = withFollowUpConsistency(dto.followUpRequired ?? existing?.followUpRequired ?? false, sentiment);

    // customerName was previously stored as whatever the form sent verbatim,
    // including "" when a reviewer cleared the field -- but "" doesn't equal
    // null in a ?? fallback chain, so a "cleared" name still displayed the
    // stale value everywhere the UI falls back on a missing name. Distinguish
    // "field not sent" (undefined, leave untouched) from "field sent blank"
    // (null, actually clear it) so clearing the field actually clears it.
    const customerNameProvided = dto.customerName !== undefined;
    const trimmedCustomerName = dto.customerName?.trim();
    const customerNameForExtraction = customerNameProvided ? trimmedCustomerName || null : undefined;

    // Calls that never got a real recording/transcript (missed, unanswered,
    // still-failed telephony webhooks) have no CallExtraction row at all --
    // upsert rather than requiring one to already exist, so those calls can
    // still be filled in by hand instead of having no edit option at all.
    const updated = await this.prisma.callExtraction.upsert({
      where: { callId },
      create: {
        callId,
        businessCategory: call.businessCategory,
        customerName: customerNameForExtraction ?? null,
        carMake: dto.carMake,
        carModel: dto.carModel,
        carVariant: dto.carVariant,
        location: dto.location,
        productsDiscussed: dto.productsDiscussed,
        customerRequirements: dto.customerRequirements,
        budget: dto.budget,
        followUpRequired,
        followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : undefined,
        summary: dto.summary,
        sentiment: dto.sentiment,
        extractedByModel: 'manual_edit',
        extractedAt: new Date(),
        editedBy: editedById,
        editedAt: new Date(),
      },
      update: {
        customerName: customerNameForExtraction,
        carMake: dto.carMake,
        carModel: dto.carModel,
        carVariant: dto.carVariant,
        location: dto.location,
        productsDiscussed: dto.productsDiscussed,
        customerRequirements: dto.customerRequirements,
        budget: dto.budget,
        followUpRequired,
        followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : undefined,
        summary: dto.summary,
        sentiment: dto.sentiment,
        editedBy: editedById,
        editedAt: new Date(),
      },
    });

    // productsDiscussed is stored both as the raw extraction snapshot above
    // and, separately, as CallProduct links to the catalog (what Reports'
    // product breakdown actually reads) -- keep the two in sync the same way
    // the live pipeline and import already do.
    if (dto.productsDiscussed !== undefined) {
      await linkDiscussedProducts(this.prisma, callId, call.businessCategory, dto.productsDiscussed);
    }

    // The Follow-ups page reads from the separate FollowUp table, not this
    // flag directly -- keep the two in sync whenever the flag/date changes
    // (including a sentiment edit alone flipping followUpRequired via the
    // consistency check above), the same way the live pipeline and
    // historical import already do.
    if (dto.followUpRequired !== undefined || dto.followUpDate !== undefined || dto.sentiment !== undefined) {
      await this.syncFollowUp(callId, updated.followUpRequired, updated.followUpDate);
    }

    // customerName here only edits this call's own extraction snapshot --
    // the Customer page searches Customer.name, a separate column, so an
    // edit here would otherwise never show up there. Propagate it, including
    // clearing it -- a reviewer blanking out a wrongly-extracted name (e.g.
    // the AI mistaking the agent's name in the transcript for the caller's)
    // needs that to actually take, not just cosmetically hide until the next
    // page load.
    if (customerNameProvided && call.customerId) {
      await this.prisma.customer.update({ where: { id: call.customerId }, data: { name: trimmedCustomerName || null } });
    }

    // Same idea for the vehicle fields, but a reviewer confirming a detail
    // here is trusted more than a fresh AI guess on some future call -- only
    // overwrite the customer's saved value when this edit actually supplies
    // one, never clear it just because this particular call's field is
    // blank (a call can legitimately have no vehicle info gathered without
    // that meaning the customer's known vehicle changed).
    if (call.customerId) {
      const vehicleUpdates: Record<string, string> = {};
      if (dto.carMake?.trim()) vehicleUpdates.carMake = dto.carMake.trim();
      if (dto.carModel?.trim()) vehicleUpdates.carModel = dto.carModel.trim();
      if (dto.carVariant?.trim()) vehicleUpdates.carVariant = dto.carVariant.trim();
      if (dto.location?.trim()) vehicleUpdates.location = dto.location.trim();
      if (Object.keys(vehicleUpdates).length > 0) {
        await this.prisma.customer.update({ where: { id: call.customerId }, data: vehicleUpdates });
      }

      // A confirmed name/vehicle detail belongs to the customer, not just
      // this one call -- backfill it onto this same customer's OTHER calls
      // too, wherever that specific field is still blank there. Deliberately
      // per-field and gap-filling only: never overwrites a value another
      // call's own extraction already has (that call may genuinely differ,
      // e.g. a different variant mentioned that time), and never touches
      // productsDiscussed/summary/budget/etc -- those describe what was
      // actually discussed on THAT call, not a customer-level fact.
      if (customerNameProvided && trimmedCustomerName) {
        await this.prisma.callExtraction.updateMany({
          where: { call: { customerId: call.customerId }, callId: { not: callId }, customerName: null },
          data: { customerName: trimmedCustomerName },
        });
      }
      for (const [field, value] of Object.entries(vehicleUpdates)) {
        await this.prisma.callExtraction.updateMany({
          where: { call: { customerId: call.customerId }, callId: { not: callId }, [field]: null },
          data: { [field]: value },
        });
      }
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
        branch: dto.branch !== undefined ? dto.branch || null : undefined,
      },
      include: { customer: true, employee: true, extraction: true },
    });

    // FollowUp.assignedTo is its own column, only ever seeded once at the
    // moment a follow-up is first created (syncFollowUp/process-call.ts) --
    // it was never kept in sync afterward, so reassigning a call's employee
    // here left the Follow-ups page permanently showing "Unassigned" even
    // after a manual edit. Keep them in lockstep going forward.
    if (dto.employeeId !== undefined) {
      await this.prisma.followUp.updateMany({
        where: { callId: id },
        data: { assignedTo: dto.employeeId || null },
      });
    }

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

  /**
   * Merges `duplicateId` into `canonicalId`: fills in any field the
   * canonical call is missing from the duplicate (rather than blindly
   * keeping one and discarding the other, which could silently drop a
   * budget/summary/follow-up that only exists on the "losing" side), unions
   * productsDiscussed, moves the transcript/follow-up over only if the
   * canonical doesn't already have one, and reassigns product links
   * (skipping ones the canonical already has). The duplicate call is then
   * deleted -- anything left attached to it (because the canonical already
   * had its own copy) is removed via cascade.
   */
  async mergeCalls(duplicateId: string, canonicalId: string, mergedById: string) {
    if (duplicateId === canonicalId) {
      throw new BadRequestException('Cannot merge a call into itself');
    }

    const [canonical, duplicate] = await Promise.all([
      this.prisma.call.findUnique({ where: { id: canonicalId }, include: { extraction: true, transcript: true } }),
      this.prisma.call.findUnique({ where: { id: duplicateId }, include: { extraction: true, transcript: true } }),
    ]);
    if (!canonical) throw new NotFoundException(`Call ${canonicalId} not found`);
    if (!duplicate) throw new NotFoundException(`Call ${duplicateId} not found`);

    await this.prisma.$transaction(async (tx) => {
      const callPatch: Prisma.CallUpdateInput = {};
      if (!canonical.employeeId && duplicate.employeeId) callPatch.employee = { connect: { id: duplicate.employeeId } };
      if (!canonical.recordingStorageKey && duplicate.recordingStorageKey) callPatch.recordingStorageKey = duplicate.recordingStorageKey;
      if (Object.keys(callPatch).length > 0) {
        await tx.call.update({ where: { id: canonicalId }, data: callPatch });
      }

      if (duplicate.extraction) {
        if (!canonical.extraction) {
          // Canonical has no extraction at all yet -- just re-point the duplicate's.
          await tx.callExtraction.update({ where: { callId: duplicateId }, data: { callId: canonicalId } });
        } else {
          const e = canonical.extraction;
          const d = duplicate.extraction;
          const patch: Prisma.CallExtractionUpdateInput = {};
          if (!e.customerName && d.customerName) patch.customerName = d.customerName;
          if (!e.carMake && d.carMake) patch.carMake = d.carMake;
          if (!e.carModel && d.carModel) patch.carModel = d.carModel;
          if (!e.carVariant && d.carVariant) patch.carVariant = d.carVariant;
          if (!e.location && d.location) patch.location = d.location;
          if (!e.customerRequirements && d.customerRequirements) patch.customerRequirements = d.customerRequirements;
          if (e.budget == null && d.budget != null) patch.budget = d.budget;
          if (!e.followUpDate && d.followUpDate) patch.followUpDate = d.followUpDate;
          if (!e.followUpRequired && d.followUpRequired) patch.followUpRequired = true;
          if (!e.summary && d.summary) patch.summary = d.summary;
          if (!e.sentiment && d.sentiment) patch.sentiment = d.sentiment;

          const existingProducts = Array.isArray(e.productsDiscussed) ? (e.productsDiscussed as string[]) : [];
          const duplicateProducts = Array.isArray(d.productsDiscussed) ? (d.productsDiscussed as string[]) : [];
          const mergedProducts = Array.from(new Set([...existingProducts, ...duplicateProducts]));
          if (mergedProducts.length !== existingProducts.length) patch.productsDiscussed = mergedProducts;

          if (Object.keys(patch).length > 0) {
            await tx.callExtraction.update({ where: { callId: canonicalId }, data: patch });
          }
        }
      }

      if (duplicate.transcript && !canonical.transcript) {
        await tx.transcript.update({ where: { callId: duplicateId }, data: { callId: canonicalId } });
      }

      const [canonicalFollowUp, duplicateFollowUp] = await Promise.all([
        tx.followUp.findFirst({ where: { callId: canonicalId } }),
        tx.followUp.findFirst({ where: { callId: duplicateId } }),
      ]);
      if (duplicateFollowUp && !canonicalFollowUp) {
        await tx.followUp.update({ where: { id: duplicateFollowUp.id }, data: { callId: canonicalId } });
      }

      const duplicateProductLinks = await tx.callProduct.findMany({ where: { callId: duplicateId } });
      if (duplicateProductLinks.length > 0) {
        await tx.callProduct.createMany({
          data: duplicateProductLinks.map((p) => ({ callId: canonicalId, productId: p.productId })),
          skipDuplicates: true,
        });
      }

      // Cascades away anything still attached (the canonical already had its
      // own copy of that data, so the duplicate's version is safe to drop).
      await tx.call.delete({ where: { id: duplicateId } });

      await tx.auditLog.create({
        data: {
          userId: mergedById,
          action: 'merge_call',
          entity: 'calls',
          entityId: canonicalId,
          details: { mergedCallId: duplicateId },
        },
      });
    });

    return this.findOne(canonicalId);
  }

  /** Populates the Car Make filter dropdown -- every distinct value actually on record. */
  async distinctCarMakes(carModel?: string[]): Promise<string[]> {
    const rows = await this.prisma.callExtraction.findMany({
      where: { carMake: { not: null }, ...(carModel?.length && { carModel: { in: carModel } }) },
      distinct: ['carMake'],
      select: { carMake: true },
      orderBy: { carMake: 'asc' },
    });
    return rows.map((r) => r.carMake!).filter((make) => make.trim() !== '');
  }

  /**
   * Populates the Car Model filter dropdown. Scoped to whichever make(s) are
   * already selected, so the list doesn't offer models that can't match --
   * otherwise every model on record. Multiple selected makes are OR'd, e.g.
   * models belonging to either make.
   */
  async distinctCarModels(carMake?: string[]): Promise<string[]> {
    const rows = await this.prisma.callExtraction.findMany({
      where: { carModel: { not: null }, ...(carMake?.length && { carMake: { in: carMake } }) },
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
