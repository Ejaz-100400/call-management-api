import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { parseIstTimestamp } from '../common/timezone.util';

const logger = new Logger('OutboundCallSync');

interface ExotelCallRecord {
  Sid: string;
  DateCreated: string;
  To: string;
  From: string;
  PhoneNumber: string;
  Status: string;
  Duration: number;
  Direction: string;
  RecordingUrl: string;
}

interface ExotelCallsPage {
  Metadata: { NextPageUri: string | null };
  Calls: ExotelCallRecord[];
}

/**
 * One page of Exotel's List Calls API, optionally continuing from a prior
 * page's cursor. `afterCursor` is the raw "After=..." token value Exotel's
 * own NextPageUri carries -- opaque to us, just round-tripped.
 */
async function fetchCallsPage(dateFrom: Date, dateTo: Date, afterCursor?: string): Promise<ExotelCallsPage> {
  const accountSid = process.env.EXOTEL_ACCOUNT_SID;
  const apiKey = process.env.EXOTEL_API_KEY;
  const apiToken = process.env.EXOTEL_API_TOKEN;
  if (!accountSid || !apiKey || !apiToken) {
    throw new Error('EXOTEL_ACCOUNT_SID/EXOTEL_API_KEY/EXOTEL_API_TOKEN must be set');
  }
  const auth = Buffer.from(`${apiKey}:${apiToken}`).toString('base64');

  const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  const params = new URLSearchParams({
    SortBy: 'DateCreated:asc',
    PageSize: '50',
    DateCreated: `gte:${fmt(dateFrom)};lte:${fmt(dateTo)}`,
  });
  if (afterCursor) params.set('After', afterCursor);

  const res = await fetch(`https://api.exotel.com/v1/Accounts/${accountSid}/Calls.json?${params.toString()}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`Exotel Calls list failed: HTTP ${res.status}`);
  return (await res.json()) as ExotelCallsPage;
}

function extractAfterCursor(nextPageUri: string | null): string | undefined {
  if (!nextPageUri) return undefined;
  const match = nextPageUri.match(/[?&]After=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Pulls outbound-dial calls from Exotel in [dateFrom, dateTo], creates a Call
 * row (+ customer, keyed on the *To* number since we're the caller here, the
 * reverse of the inbound webhook) for any not already tracked by
 * externalCallId, and enqueues each new one for the same transcription/AI
 * pipeline inbound calls already get. Idempotent -- safe to re-run over an
 * overlapping window, existing rows are skipped.
 */
export async function syncOutboundCalls(
  prisma: PrismaClient,
  enqueue: (job: { type: 'full_reprocess'; callId: string; recordingUrl?: string; callSid?: string }) => Promise<unknown>,
  dateFrom: Date,
  dateTo: Date,
): Promise<{ created: number; skipped: number }> {
  const businessNumbers = await prisma.businessNumber.findMany({ select: { exophoneNumber: true, businessCategory: true } });
  const categoryByExophone = new Map(
    businessNumbers.filter((n) => n.exophoneNumber).map((n) => [n.exophoneNumber as string, n.businessCategory]),
  );
  const employees = await prisma.employee.findMany({ select: { id: true, phone: true } });
  const employeeByPhone = new Map(employees.filter((e) => e.phone).map((e) => [e.phone!.replace(/\D/g, '').slice(-10), e.id]));

  let created = 0;
  let skipped = 0;
  let cursor: string | undefined;
  // Bounded to 50 pages (2,500 calls) per run so a misbehaving date range
  // can't loop forever -- ample for any realistic sync window.
  for (let i = 0; i < 50; i++) {
    const page = await fetchCallsPage(dateFrom, dateTo, cursor);
    const outbound = page.Calls.filter((c) => c.Direction === 'outbound-dial');

    for (const call of outbound) {
      const existing = await prisma.call.findUnique({ where: { externalCallId: call.Sid }, select: { id: true } });
      if (existing) {
        skipped++;
        continue;
      }

      const category = categoryByExophone.get(call.PhoneNumber) ?? 'unknown';
      const employeeId = employeeByPhone.get(call.From.replace(/\D/g, '').slice(-10));

      const customer = await prisma.customer.upsert({
        where: { phoneNumber: call.To },
        create: { phoneNumber: call.To },
        update: {},
      });

      const callRow = await prisma.call.create({
        data: {
          externalCallId: call.Sid,
          direction: 'outbound',
          businessCategory: category,
          employeeId,
          customerId: customer.id,
          callDate: parseIstTimestamp(call.DateCreated) ?? new Date(call.DateCreated),
          durationSeconds: call.Duration,
          recordingStorageKey: null,
          status: 'pending',
        },
      });

      await enqueue({
        type: 'full_reprocess',
        callId: callRow.id,
        recordingUrl: call.RecordingUrl || undefined,
        callSid: call.Sid,
      });
      created++;
    }

    const nextCursor = extractAfterCursor(page.Metadata.NextPageUri);
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  logger.log(`Outbound sync [${dateFrom.toISOString()} .. ${dateTo.toISOString()}]: ${created} created, ${skipped} already tracked`);
  return { created, skipped };
}
