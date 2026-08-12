import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BusinessCategory, Prisma, SentimentType } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { CommitPhotoRowDto } from './dto/commit-photo-rows.dto';
import { linkDiscussedProducts } from '../common/product-matching.util';
import { defaultFollowUpDueDate } from '../follow-ups/follow-up.util';
import { extractHandwrittenEntries, isSupportedImageType, type ExtractedEntry } from './ocr.provider';

const MAX_ROWS = 1000;
const MAX_PHOTOS = 30;
const PREVIEW_MAX_ROWS = 50;
const PREVIEW_MAX_SHEETS = 20;
// How many rows' independent transactions run at once during a commit --
// bounded rather than fully unbounded since a single request can carry up
// to 1000 rows (see CommitPhotoRowsDto's ArrayMaxSize) and every row opens
// its own transaction against the pooled connection.
const IMPORT_CONCURRENCY = 20;

/** Runs `fn` over `items` with at most `limit` in flight at once, preserving each item's index and isolating its success/failure from the rest. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: Error }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: Error }> = new Array(items.length);
  let next = 0;

  async function worker() {
    for (let i = next++; i < items.length; i = next++) {
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (err) {
        results[i] = { ok: false, error: err as Error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface ParsedRow {
  phone: string;
  category: BusinessCategory;
  callDate: Date;
  customerName?: string;
  employeeId?: string;
  duration: number;
  carMake?: string;
  carModel?: string;
  carVariant?: string;
  location?: string;
  products: string[];
  requirements?: string;
  budget?: number;
  followUpRequired: boolean;
  followUpDate?: Date;
  summary?: string;
  sentiment?: SentimentType;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

export interface ImportedRowSummary {
  callId: string;
  customerName?: string;
  phoneNumber: string;
  businessCategory: BusinessCategory;
  callDate: Date;
  location?: string;
}

export interface CommitRowsResult extends ImportResult {
  importedRows: ImportedRowSummary[];
}

export interface ParsedExcelRow {
  sourceRow: number;
  phoneNumber: string;
  businessCategory?: BusinessCategory;
  callDate?: string;
  customerName?: string;
  employeeId?: string;
  durationSeconds?: number;
  carMake?: string;
  carModel?: string;
  carVariant?: string;
  location?: string;
  productsDiscussed?: string[];
  customerRequirements?: string;
  budget?: number;
  followUpRequired?: boolean;
  followUpDate?: string;
  summary?: string;
  sentiment?: SentimentType;
}

export interface RawSheetPreview {
  headers: string[];
  rows: string[][];
  totalDataRows: number;
}

export interface SheetPreview {
  name: string;
  preview: RawSheetPreview;
}

export interface ParseExcelResult {
  rows: ParsedExcelRow[];
  errors: Array<{ row: number; reason: string }>;
  // Every sheet in the workbook, not just the one actually imported (always
  // sheets[0] -- see parseExcel) -- lets the frontend show tabs like Excel
  // does so the user can flip through and confirm data is where expected.
  sheets: SheetPreview[];
}

export interface PhotoExtractResult {
  sourceFile: string;
  entries: ExtractedEntry[];
  error?: string;
}

@Injectable()
export class ImportService {
  constructor(private prisma: PrismaService) {}

  async generateTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Calls');

    sheet.columns = [
      { header: 'Call Date', key: 'callDate', width: 20 },
      { header: 'Business Category', key: 'businessCategory', width: 20 },
      { header: 'Phone Number*', key: 'phoneNumber', width: 16 },
      { header: 'Customer Name', key: 'customerName', width: 22 },
      { header: 'Employee (name or email)', key: 'employee', width: 24 },
      { header: 'Duration Seconds', key: 'duration', width: 14 },
      { header: 'Car Make', key: 'carMake', width: 14 },
      { header: 'Car Model', key: 'carModel', width: 14 },
      { header: 'Car Variant', key: 'carVariant', width: 14 },
      { header: 'Location', key: 'location', width: 18 },
      { header: 'Products Discussed (comma-separated)', key: 'products', width: 36 },
      { header: 'Customer Requirements', key: 'requirements', width: 30 },
      { header: 'Budget', key: 'budget', width: 12 },
      { header: 'Follow-up Required (Yes/No)', key: 'followUpRequired', width: 20 },
      { header: 'Follow-up Date', key: 'followUpDate', width: 16 },
      { header: 'Summary', key: 'summary', width: 40 },
      { header: 'Sentiment', key: 'sentiment', width: 18 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.addRow({
      callDate: '2024-05-10 14:30',
      businessCategory: 'Car Glasses',
      phoneNumber: '+919876543210',
      customerName: 'Ravi Kumar',
      employee: 'Dastagir',
      duration: 240,
      carMake: 'Maruti',
      carModel: 'Swift',
      carVariant: 'VXI',
      location: 'Ambattur',
      products: 'Windshield replacement, Tinting',
      requirements: 'Cracked windshield, wants same-day fitting',
      budget: 8000,
      followUpRequired: 'No',
      followUpDate: '',
      summary: 'Customer called about a cracked windshield, booked for next day.',
      sentiment: 'Interested',
    });

    // Dropdowns for the columns with a fixed/known set of valid values --
    // cuts down on the typos/casing drift free-text entry invites (this is
    // the same problem normalizeVehicleField() cleans up after the fact,
    // but stopping it at entry time is better). ExcelJS's typings don't
    // expose the range-based Worksheet#dataValidations helper even though
    // it exists at runtime, so this sets it per-cell via the documented API.
    const LAST_ROW = MAX_ROWS + 1;
    const applyListValidation = (
      targetSheet: ExcelJS.Worksheet,
      column: string,
      formula: string,
      errorMessage: string,
    ) => {
      for (let row = 2; row <= LAST_ROW; row++) {
        targetSheet.getCell(`${column}${row}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [formula],
          showErrorMessage: true,
          errorStyle: 'warning',
          error: errorMessage,
        };
      }
    };

    applyListValidation(sheet, 'B', '"Car Glasses,Car Modifications,Unknown"', 'Pick from the list, or leave blank if unknown.');
    applyListValidation(sheet, 'Q', '"Interested,Not Interested,Needs Follow-up"', 'Pick from the list, or leave blank if unknown.');

    // Employee names are per-business data, not a fixed set -- list them on
    // a hidden helper sheet and point the dropdown at that range, the same
    // way Excel handles any dynamic list.
    const activeEmployees = await this.prisma.employee.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    if (activeEmployees.length > 0) {
      const lists = workbook.addWorksheet('Lists', { state: 'hidden' });
      lists.getCell('A1').value = 'Employees';
      activeEmployees.forEach((emp, i) => {
        lists.getCell(`A${i + 2}`).value = emp.name;
      });
      applyListValidation(sheet, 'E', `Lists!$A$2:$A$${activeEmployees.length + 1}`, 'Pick from the list, or leave blank if unassigned.');
    }

    const notes = workbook.addWorksheet('Instructions');
    notes.columns = [
      { header: 'Field', key: 'field', width: 26 },
      { header: 'Notes', key: 'notes', width: 90 },
    ];
    notes.getRow(1).font = { bold: true };
    notes.addRows([
      { field: 'Call Date', notes: 'Any recognizable date/time format, e.g. 2024-05-10 14:30 or 05/10/2024. Leave blank if unknown -- defaults to the import date.' },
      { field: 'Business Category', notes: '"Car Glasses" or "Car Modifications". Leave blank if unknown -- saved as "Unknown".' },
      { field: 'Phone Number*', notes: 'Required. Used to match an existing customer or create a new one.' },
      { field: 'Employee', notes: 'Matched by exact name or email against your Employees list. Leave blank if unknown -- the row still imports.' },
      { field: 'Location', notes: 'Free text -- the area, shop, or place associated with this call, if you track one.' },
      { field: 'Products Discussed', notes: 'Comma-separated. Matched against your product catalog automatically, the same way live AI-processed calls are.' },
      { field: 'Follow-up Required', notes: 'Yes/No. If Yes and a Follow-up Date is set, a follow-up task is created and assigned to the matched employee.' },
      { field: 'Sentiment', notes: 'One of: Interested, Not Interested, Needs Follow-up. Leave blank if unknown.' },
      { field: 'Limit', notes: `Up to ${MAX_ROWS} rows per file -- split larger spreadsheets into multiple uploads.` },
    ]);

    const rawBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(rawBuffer as unknown as ArrayBuffer);
  }

  history() {
    return this.prisma.auditLog.findMany({
      where: { action: 'import_historical_calls' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { name: true, email: true } } },
    });
  }

  /**
   * Undoes one import batch entirely -- deletes every Call this specific
   * history entry created (cascading to its extraction/transcript/
   * follow-ups/product links) and removes the history entry itself.
   * Entries recorded before callId was tracked on each row have nothing to
   * delete here -- Calls -> Find Duplicates is the fallback for those.
   */
  async deleteImportBatch(auditLogId: string) {
    const entry = await this.prisma.auditLog.findUnique({ where: { id: auditLogId } });
    if (!entry || entry.action !== 'import_historical_calls') {
      throw new NotFoundException('Import history entry not found');
    }

    const rows = ((entry.details as { rows?: ImportedRowSummary[] } | null)?.rows ?? []) as ImportedRowSummary[];
    const callIds = rows.map((r) => r.callId).filter((id): id is string => Boolean(id));

    const deleted = callIds.length > 0 ? await this.prisma.call.deleteMany({ where: { id: { in: callIds } } }) : { count: 0 };
    await this.prisma.auditLog.delete({ where: { id: auditLogId } });

    return { deletedCalls: deleted.count };
  }

  /**
   * Reads photos of handwritten notes via Claude vision and returns the raw
   * extraction for the caller to review/edit -- nothing is persisted here.
   * A small concurrency limit keeps wall-clock time reasonable for a batch
   * without hammering the Anthropic API.
   */
  async extractFromPhotos(files: Express.Multer.File[]): Promise<PhotoExtractResult[]> {
    if (files.length > MAX_PHOTOS) {
      throw new BadRequestException(`Up to ${MAX_PHOTOS} photos per batch -- split into multiple uploads.`);
    }

    // Each photo is an independent, network-bound Claude vision call -- higher
    // concurrency cuts wall-clock time roughly proportionally for a full batch.
    const CONCURRENCY = 6;
    const results: PhotoExtractResult[] = new Array(files.length);
    let next = 0;

    async function worker() {
      while (next < files.length) {
        const i = next++;
        const file = files[i];
        if (!isSupportedImageType(file.mimetype)) {
          results[i] = { sourceFile: file.originalname, entries: [], error: `Unsupported file type (${file.mimetype})` };
          continue;
        }
        try {
          const entries = await extractHandwrittenEntries(file.buffer, file.mimetype);
          results[i] = { sourceFile: file.originalname, entries };
        } catch (err) {
          results[i] = { sourceFile: file.originalname, entries: [], error: (err as Error).message };
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => worker()));
    return results;
  }

  /**
   * Persists one batch of rows the caller has already confirmed/edited --
   * same underlying write path regardless of source (photo-scan review or
   * parsed Excel), so historical data behaves identically everywhere else
   * in the app (reports, product matching, etc.). Does NOT write an audit
   * log entry itself -- callers commit in batches (for progress feedback)
   * and call recordImportHistory() once at the end with the totals.
   */
  async commitPhotoRows(rows: CommitPhotoRowDto[], userId: string): Promise<CommitRowsResult> {
    const result: CommitRowsResult = { imported: 0, skipped: 0, errors: [], importedRows: [] };
    // Shared across the whole batch -- a photo/spreadsheet import is often
    // dozens of rows for the same handful of cars, so without this every row
    // re-runs the same similarity lookup against the DB from scratch.
    const vehicleCache = new Map<string, string>();

    // Each row is its own independent transaction, so there's no reason to
    // wait for one to finish before starting the next -- running them
    // concurrently (bounded by IMPORT_CONCURRENCY) overlaps the several
    // round trips each row makes (customer upsert, call create, vehicle
    // similarity lookups, ...) instead of paying for every one of them
    // serially, which is most of where the time goes importing a few
    // hundred rows against a remote/pooled Postgres connection.
    const settled = await mapWithConcurrency(rows, IMPORT_CONCURRENCY, async (row) => {
      const parsed: ParsedRow = {
        // Phone number is the only field that must be filled in by the
        // reviewer -- the DTO already validates it's non-empty here.
        phone: row.phoneNumber.trim(),
        // Category and call date are frequently unrecoverable from messy
        // historical notes -- fall back to "unknown" / the import date
        // rather than blocking the row from being saved at all.
        category: row.businessCategory ?? 'unknown',
        callDate: row.callDate ? new Date(row.callDate) : new Date(),
        customerName: row.customerName?.trim() || undefined,
        employeeId: row.employeeId,
        duration: row.durationSeconds ?? 0,
        carMake: row.carMake?.trim() || undefined,
        carModel: row.carModel?.trim() || undefined,
        carVariant: row.carVariant?.trim() || undefined,
        location: row.location?.trim() || undefined,
        products: (row.productsDiscussed ?? []).map((p) => p.trim()).filter(Boolean),
        requirements: row.customerRequirements?.trim() || undefined,
        budget: row.budget,
        followUpRequired: row.followUpRequired ?? false,
        followUpDate: row.followUpDate ? new Date(row.followUpDate) : undefined,
        summary: row.summary?.trim() || undefined,
        sentiment: row.sentiment,
      };
      const callId = await this.prisma.$transaction((tx) => this.persistRow(tx, parsed, userId, vehicleCache));
      return {
        callId,
        customerName: parsed.customerName,
        phoneNumber: parsed.phone,
        businessCategory: parsed.category,
        callDate: parsed.callDate,
        location: parsed.location,
      };
    });

    settled.forEach((s, i) => {
      if (s.ok) {
        result.imported++;
        result.importedRows.push(s.value);
      } else {
        result.skipped++;
        result.errors.push({ row: i + 1, reason: s.error.message });
      }
    });

    return result;
  }

  /**
   * Writes the single audit log entry for a (possibly multi-batch) import,
   * once the caller has committed every batch and aggregated the totals.
   */
  async recordImportHistory(
    userId: string,
    source: 'excel' | 'photo_ocr' | 'manual',
    result: ImportResult,
    importedRows: ImportedRowSummary[],
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'import_historical_calls',
        entity: 'calls',
        details: { ...result, source, rows: importedRows } as unknown as object,
      },
    });
  }

  /**
   * Parses an Excel file into rows ready for commitPhotoRows(), without
   * persisting anything -- mirrors the photo-scan extract phase so both
   * import paths share the same review-then-batch-commit flow.
   */
  async parseExcel(buffer: Buffer, sheetIndex = 0): Promise<ParseExcelResult> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Could not read this file -- please upload a valid .xlsx file.');
    }

    // Literal grid of every sheet (raw header/cell text, not mapped to our
    // internal fields) -- lets the frontend show a real "how Excel looks"
    // preview, tabs included, so the user can visually confirm it's the
    // right file/sheet before the rows below get matched against our schema.
    const sheets: SheetPreview[] = workbook.worksheets
      .slice(0, PREVIEW_MAX_SHEETS)
      .map((ws) => ({ name: ws.name, preview: this.buildRawPreview(ws) }));

    // sheetIndex picks which sheet actually gets parsed into `rows` -- the
    // caller (frontend) defaults to 0 but lets the user switch to any sheet
    // shown in `sheets` above and re-parse that one instead.
    const sheet = workbook.worksheets[sheetIndex];
    if (!sheet) throw new BadRequestException('That sheet was not found in this file.');

    const columnMap = this.buildColumnMap(sheet.getRow(1));
    const cols = this.resolveColumns(columnMap);
    if (!cols.phone) {
      throw new BadRequestException('Could not find the required Phone Number column. Please use the provided template.');
    }

    const employees = await this.prisma.employee.findMany({ where: { active: true } });
    const employeesByEmail = new Map(employees.filter((e) => e.email).map((e) => [e.email!.toLowerCase(), e.id]));
    const employeesByName = new Map(employees.map((e) => [e.name.toLowerCase(), e.id]));

    const rows: ParsedExcelRow[] = [];
    const errors: Array<{ row: number; reason: string }> = [];
    const lastRow = Math.min(sheet.rowCount, MAX_ROWS + 1);

    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
      const row = sheet.getRow(rowNumber);

      try {
        if (this.isBlankRow(row, cols)) continue;
        const parsed = this.parseRow(row, cols, employeesByEmail, employeesByName);
        // Unlike photo-scan (where "can't tell from handwriting" genuinely
        // means Unknown), a spreadsheet row with no recognizable category is
        // almost always a data-entry gap -- exclude it rather than import it
        // silently as Unknown.
        if (parsed.category === 'unknown') {
          errors.push({ row: rowNumber, reason: 'Business category is Unknown -- row skipped.' });
          continue;
        }
        rows.push({
          sourceRow: rowNumber,
          phoneNumber: parsed.phone,
          businessCategory: parsed.category,
          callDate: parsed.callDate.toISOString(),
          customerName: parsed.customerName,
          employeeId: parsed.employeeId,
          durationSeconds: parsed.duration,
          carMake: parsed.carMake,
          carModel: parsed.carModel,
          carVariant: parsed.carVariant,
          location: parsed.location,
          productsDiscussed: parsed.products,
          customerRequirements: parsed.requirements,
          budget: parsed.budget,
          followUpRequired: parsed.followUpRequired,
          followUpDate: parsed.followUpDate?.toISOString(),
          summary: parsed.summary,
          sentiment: parsed.sentiment,
        });
      } catch (err) {
        // Trailing rows that only carry leftover formatting (borders/fill
        // from a big copy-paste, no real values) can trip an internal
        // ExcelJS error when it tries to read a cell that was never really
        // written -- there's nothing to import there, so skip silently
        // instead of showing a meaningless "row issue" for an empty row.
        if ((err as Error).message === 'A Cell needs a Row') continue;
        errors.push({ row: rowNumber, reason: (err as Error).message });
      }
    }

    if (sheet.rowCount > MAX_ROWS + 1) {
      errors.push({
        row: MAX_ROWS + 2,
        reason: `File has more than ${MAX_ROWS} data rows -- everything after row ${MAX_ROWS + 1} was not processed. Split the file and re-upload the rest.`,
      });
    }

    return { rows, errors, sheets };
  }

  private buildRawPreview(sheet: ExcelJS.Worksheet): RawSheetPreview {
    const colCount = Math.max(sheet.actualColumnCount, 1);
    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    for (let c = 1; c <= colCount; c++) headers.push(this.cellPreviewText(headerRow.getCell(c)));

    // Blank rows are kept (unlike the real parse below, which skips them) --
    // this is a literal "what does row N actually look like" preview, so row
    // numbers need to line up with the file exactly the way Excel shows them.
    const lastPreviewRow = Math.min(sheet.rowCount, PREVIEW_MAX_ROWS + 1);
    const rows: string[][] = [];
    for (let r = 2; r <= lastPreviewRow; r++) {
      const row = sheet.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= colCount; c++) cells.push(this.cellPreviewText(row.getCell(c)));
      rows.push(cells);
    }

    return { headers, rows, totalDataRows: Math.max(sheet.rowCount - 1, 0) };
  }

  /** Best-effort plain-text rendering of a cell for the raw preview grid -- display only, never fed back into parseRow(). */
  private cellPreviewText(cell: ExcelJS.Cell): string {
    if (cell.value == null) return '';
    if (cell.type === ExcelJS.ValueType.Date) {
      const d = cell.value as Date;
      return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
    }
    return (cell.text ?? '').toString().trim();
  }

  private buildColumnMap(headerRow: ExcelJS.Row): Map<string, number> {
    const map = new Map<string, number>();
    headerRow.eachCell((cell, colNumber) => {
      const key = this.cellText(cell.value).replace(/\*/g, '').trim().toLowerCase();
      if (key) map.set(key, colNumber);
    });
    return map;
  }

  private resolveColumns(columnMap: Map<string, number>) {
    const keys = [...columnMap.keys()];
    const find = (...keywords: string[]) => {
      const key = keys.find((h) => keywords.every((k) => h.includes(k)));
      return key ? columnMap.get(key) : undefined;
    };

    return {
      callDate: find('call', 'date') ?? find('date'),
      category: find('category'),
      phone: find('phone'),
      customerName: find('customer', 'name'),
      employee: find('employee'),
      duration: find('duration'),
      carMake: find('make'),
      carModel: find('model'),
      carVariant: find('variant'),
      location: find('location'),
      products: find('product'),
      requirements: find('requirement'),
      budget: find('budget'),
      followUpRequired: find('follow', 'required'),
      followUpDate: find('follow', 'date'),
      summary: find('summary'),
      sentiment: find('sentiment'),
    };
  }

  private isBlankRow(row: ExcelJS.Row, cols: ReturnType<ImportService['resolveColumns']>): boolean {
    const phone = cols.phone ? this.cellText(row.getCell(cols.phone).value) : '';
    const date = cols.callDate ? this.cellText(row.getCell(cols.callDate).value) : '';
    const category = cols.category ? this.cellText(row.getCell(cols.category).value) : '';
    return !phone && !date && !category;
  }

  private parseRow(
    row: ExcelJS.Row,
    cols: ReturnType<ImportService['resolveColumns']>,
    employeesByEmail: Map<string, string>,
    employeesByName: Map<string, string>,
  ): ParsedRow {
    const phone = this.cellText(row.getCell(cols.phone!).value);
    if (!phone) throw new Error('Missing phone number');

    // Category and call date are frequently unrecoverable from messy
    // historical records -- and the column itself may not even exist in a
    // given file -- so default rather than throw either way.
    const callDate = cols.callDate ? (this.parseDate(row.getCell(cols.callDate).value) ?? new Date()) : new Date();
    const category = cols.category
      ? (this.parseCategory(this.cellText(row.getCell(cols.category).value)) ?? 'unknown')
      : 'unknown';

    const employeeRaw = cols.employee ? this.cellText(row.getCell(cols.employee).value) : '';
    const employeeId = employeeRaw
      ? (employeesByEmail.get(employeeRaw.toLowerCase()) ?? employeesByName.get(employeeRaw.toLowerCase()))
      : undefined;

    const followUpRequiredRaw = cols.followUpRequired ? this.cellText(row.getCell(cols.followUpRequired).value) : '';
    const followUpRequired = /^(yes|true|1)$/i.test(followUpRequiredRaw.trim());
    const followUpDate = cols.followUpDate ? (this.parseDate(row.getCell(cols.followUpDate).value) ?? undefined) : undefined;

    const productsRaw = cols.products ? this.cellText(row.getCell(cols.products).value) : '';
    const products = productsRaw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    const budgetRaw = cols.budget ? this.cellText(row.getCell(cols.budget).value) : '';
    const budget = budgetRaw ? Number(budgetRaw.replace(/[^0-9.]/g, '')) : undefined;

    return {
      phone,
      category,
      callDate,
      customerName: cols.customerName ? this.cellText(row.getCell(cols.customerName).value) || undefined : undefined,
      employeeId,
      duration: cols.duration ? Number(this.cellText(row.getCell(cols.duration).value)) || 0 : 0,
      carMake: cols.carMake ? this.cellText(row.getCell(cols.carMake).value) || undefined : undefined,
      carModel: cols.carModel ? this.cellText(row.getCell(cols.carModel).value) || undefined : undefined,
      carVariant: cols.carVariant ? this.cellText(row.getCell(cols.carVariant).value) || undefined : undefined,
      location: cols.location ? this.cellText(row.getCell(cols.location).value) || undefined : undefined,
      products,
      requirements: cols.requirements ? this.cellText(row.getCell(cols.requirements).value) || undefined : undefined,
      budget: budget != null && !Number.isNaN(budget) ? budget : undefined,
      followUpRequired,
      followUpDate,
      summary: cols.summary ? this.cellText(row.getCell(cols.summary).value) || undefined : undefined,
      sentiment: cols.sentiment ? this.parseSentiment(this.cellText(row.getCell(cols.sentiment).value)) : undefined,
    };
  }

  private async persistRow(
    tx: Prisma.TransactionClient,
    data: ParsedRow,
    importedByUserId: string,
    vehicleCache?: Map<string, string>,
  ) {
    const customer = await tx.customer.upsert({
      where: { phoneNumber: data.phone },
      create: { phoneNumber: data.phone, name: data.customerName ?? null },
      update: data.customerName ? { name: data.customerName } : {},
    });

    const call = await tx.call.create({
      data: {
        businessCategory: data.category,
        employeeId: data.employeeId,
        customerId: customer.id,
        callDate: data.callDate,
        durationSeconds: data.duration,
        status: 'completed',
        importedByUserId,
      },
    });

    const [carMake, carModel] = await Promise.all([
      data.carMake ? this.normalizeVehicleField(tx, 'car_make', data.carMake, undefined, vehicleCache) : undefined,
      data.carModel ? this.normalizeVehicleField(tx, 'car_model', data.carModel, data.carMake, vehicleCache) : undefined,
    ]);

    await tx.callExtraction.create({
      data: {
        callId: call.id,
        customerName: data.customerName,
        phoneNumber: data.phone,
        businessCategory: data.category,
        carMake,
        carModel,
        carVariant: data.carVariant,
        location: data.location,
        productsDiscussed: data.products,
        customerRequirements: data.requirements,
        budget: data.budget,
        followUpRequired: data.followUpRequired,
        followUpDate: data.followUpDate,
        summary: data.summary,
        sentiment: data.sentiment,
        extractedByModel: 'manual_import',
        extractedAt: new Date(),
      },
    });

    if (data.followUpRequired) {
      // A row can be flagged as needing follow-up without a specific date attached
      // (common when reviewing messy historical notes) -- default rather than
      // silently never creating the task, which is invisible on the Follow-ups page.
      const dueDate = data.followUpDate ?? defaultFollowUpDueDate();
      await tx.followUp.create({
        data: { callId: call.id, dueDate, assignedTo: data.employeeId },
      });
    }

    if (data.products.length > 0) {
      await linkDiscussedProducts(tx, call.id, data.category, data.products);
    }

    return call.id;
  }

  /**
   * Excel/manual-entry rows are hand-typed, so "ford" vs "Ford" or a stray
   * trailing character creep in easily -- snap to an existing value already
   * on record when it's a near-exact match (case/typo only), so the same
   * car doesn't fragment into multiple spellings across imports. Live calls
   * and photo-scan OCR get this from the AI prompt instead, since Claude can
   * correct spelling even the very first time a model is ever seen.
   */
  private async normalizeVehicleField(
    tx: Prisma.TransactionClient,
    column: 'car_make' | 'car_model',
    raw: string,
    makeToStrip?: string,
    cache?: Map<string, string>,
  ): Promise<string> {
    let cleaned = raw.trim().replace(/[`'"]+$/g, '').trim();
    if (!cleaned) return cleaned;

    // The model field shouldn't repeat the make (e.g. "Maruti Swift" typed
    // into Car Model when Car Make is already "Maruti") -- strip it, unless
    // that's literally all there is (e.g. "BMW 2011" with no real model
    // ever given -- stripping to "2011" would just be worse than leaving it).
    if (column === 'car_model' && makeToStrip?.trim()) {
      const make = makeToStrip.trim();
      if (cleaned.toLowerCase().startsWith(`${make.toLowerCase()} `)) {
        const withoutMake = cleaned.slice(make.length).trim();
        if (withoutMake && !/^\d+$/.test(withoutMake)) cleaned = withoutMake;
      }
    }

    const cacheKey = `${column}:${makeToStrip ?? ''}:${cleaned.toLowerCase()}`;
    const cached = cache?.get(cacheKey);
    if (cached !== undefined) return cached;

    const [best] = await tx.$queryRaw<Array<{ value: string; similarity: number }>>(Prisma.sql`
      SELECT value, similarity(value, ${cleaned}) AS similarity
      FROM (SELECT DISTINCT ${Prisma.raw(column)} AS value FROM call_extractions WHERE ${Prisma.raw(column)} IS NOT NULL) t
      ORDER BY similarity DESC
      LIMIT 1;
    `);
    // High threshold -- only fixes near-identical spelling/casing (e.g.
    // "ford" -> "Ford"), never merges genuinely different names.
    const VEHICLE_MATCH_THRESHOLD = 0.6;
    const result = best && best.similarity >= VEHICLE_MATCH_THRESHOLD ? best.value : cleaned;
    cache?.set(cacheKey, result);
    return result;
  }

  /**
   * Mirrors the pg_trgm fuzzy-matching approach the live AI pipeline uses
   * (worker/processors/process-call.ts) so historical imports land in the
   * same reports/product-analytics views the same way live calls do.
   */
  private parseCategory(value: string): BusinessCategory | null {
    const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
    if (normalized === 'car glasses') return 'car_glasses';
    if (normalized === 'car modifications' || normalized === 'car mods') return 'car_modifications';
    // Explicit rather than relying on parseRow()'s ?? 'unknown' fallback --
    // that fallback exists for genuinely unrecognized/blank cells, this is
    // someone deliberately picking "Unknown" from the template's dropdown.
    if (normalized === 'unknown') return 'unknown';
    return null;
  }

  private parseSentiment(value: string): SentimentType | undefined {
    const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
    if (normalized === 'interested') return 'interested';
    if (normalized === 'not interested') return 'not_interested';
    if (normalized === 'needs follow up') return 'needs_follow_up';
    return undefined;
  }

  private parseDate(value: unknown): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = new Date(value.trim());
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  private cellText(value: unknown): string {
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      const obj = value as { text?: string; richText?: Array<{ text: string }>; result?: unknown };
      if (typeof obj.text === 'string') return obj.text.trim();
      if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text).join('').trim();
      if (obj.result != null) return this.cellText(obj.result);
      return '';
    }
    return String(value).trim();
  }
}
