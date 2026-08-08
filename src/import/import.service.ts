import { BadRequestException, Injectable } from '@nestjs/common';
import { BusinessCategory, Prisma, SentimentType } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { CommitPhotoRowDto } from './dto/commit-photo-rows.dto';
import { extractHandwrittenEntries, isSupportedImageType, type ExtractedEntry } from './ocr.provider';

const MAX_ROWS = 1000;
const MAX_PHOTOS = 30;
const PRODUCT_MATCH_THRESHOLD = 0.25;

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
      products: 'Windshield replacement, Tinting',
      requirements: 'Cracked windshield, wants same-day fitting',
      budget: 8000,
      followUpRequired: 'No',
      followUpDate: '',
      summary: 'Customer called about a cracked windshield, booked for next day.',
      sentiment: 'Interested',
    });

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
   * Reads photos of handwritten notes via Claude vision and returns the raw
   * extraction for the caller to review/edit -- nothing is persisted here.
   * A small concurrency limit keeps wall-clock time reasonable for a batch
   * without hammering the Anthropic API.
   */
  async extractFromPhotos(files: Express.Multer.File[]): Promise<PhotoExtractResult[]> {
    if (files.length > MAX_PHOTOS) {
      throw new BadRequestException(`Up to ${MAX_PHOTOS} photos per batch -- split into multiple uploads.`);
    }

    const CONCURRENCY = 3;
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
   * Persists rows the reviewer has already confirmed/edited in the UI --
   * same underlying write path as the Excel import (persistRow), so photo-
   * sourced historical data behaves identically to spreadsheet-sourced data
   * everywhere else in the app (reports, product matching, etc.).
   */
  async commitPhotoRows(rows: CommitPhotoRowDto[], userId: string): Promise<ImportResult> {
    const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
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
          products: (row.productsDiscussed ?? []).map((p) => p.trim()).filter(Boolean),
          requirements: row.customerRequirements?.trim() || undefined,
          budget: row.budget,
          followUpRequired: row.followUpRequired ?? false,
          followUpDate: row.followUpDate ? new Date(row.followUpDate) : undefined,
          summary: row.summary?.trim() || undefined,
          sentiment: row.sentiment,
        };
        await this.prisma.$transaction((tx) => this.persistRow(tx, parsed, userId));
        result.imported++;
      } catch (err) {
        result.skipped++;
        result.errors.push({ row: i + 1, reason: (err as Error).message });
      }
    }

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'import_historical_calls',
        entity: 'calls',
        details: { ...result, source: 'photo_ocr' } as unknown as object,
      },
    });

    return result;
  }

  async importFromExcel(buffer: Buffer, userId: string): Promise<ImportResult> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Could not read this file -- please upload a valid .xlsx file.');
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('No worksheet found in this file.');

    const columnMap = this.buildColumnMap(sheet.getRow(1));
    const cols = this.resolveColumns(columnMap);
    if (!cols.phone) {
      throw new BadRequestException('Could not find the required Phone Number column. Please use the provided template.');
    }

    const employees = await this.prisma.employee.findMany({ where: { active: true } });
    const employeesByEmail = new Map(employees.filter((e) => e.email).map((e) => [e.email!.toLowerCase(), e.id]));
    const employeesByName = new Map(employees.map((e) => [e.name.toLowerCase(), e.id]));

    const result: ImportResult = { imported: 0, skipped: 0, errors: [] };
    const lastRow = Math.min(sheet.rowCount, MAX_ROWS + 1);

    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      if (this.isBlankRow(row, cols)) continue;

      try {
        const parsed = this.parseRow(row, cols, employeesByEmail, employeesByName);
        await this.prisma.$transaction((tx) => this.persistRow(tx, parsed, userId));
        result.imported++;
      } catch (err) {
        result.skipped++;
        result.errors.push({ row: rowNumber, reason: (err as Error).message });
      }
    }

    if (sheet.rowCount > MAX_ROWS + 1) {
      result.errors.push({
        row: MAX_ROWS + 2,
        reason: `File has more than ${MAX_ROWS} data rows -- everything after row ${MAX_ROWS + 1} was not processed. Split the file and re-upload the rest.`,
      });
    }

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'import_historical_calls',
        entity: 'calls',
        details: result as unknown as object,
      },
    });

    return result;
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
    // historical records -- default rather than skip the row over them.
    const callDate = this.parseDate(row.getCell(cols.callDate!).value) ?? new Date();
    const category = this.parseCategory(this.cellText(row.getCell(cols.category!).value)) ?? 'unknown';

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
      products,
      requirements: cols.requirements ? this.cellText(row.getCell(cols.requirements).value) || undefined : undefined,
      budget: budget != null && !Number.isNaN(budget) ? budget : undefined,
      followUpRequired,
      followUpDate,
      summary: cols.summary ? this.cellText(row.getCell(cols.summary).value) || undefined : undefined,
      sentiment: cols.sentiment ? this.parseSentiment(this.cellText(row.getCell(cols.sentiment).value)) : undefined,
    };
  }

  private async persistRow(tx: Prisma.TransactionClient, data: ParsedRow, importedByUserId: string) {
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

    await tx.callExtraction.create({
      data: {
        callId: call.id,
        customerName: data.customerName,
        phoneNumber: data.phone,
        businessCategory: data.category,
        carMake: data.carMake,
        carModel: data.carModel,
        carVariant: data.carVariant,
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

    if (data.followUpRequired && data.followUpDate) {
      await tx.followUp.create({
        data: { callId: call.id, dueDate: data.followUpDate, assignedTo: data.employeeId },
      });
    }

    if (data.products.length > 0) {
      await this.linkDiscussedProducts(tx, call.id, data.category, data.products);
    }
  }

  /**
   * Mirrors the pg_trgm fuzzy-matching approach the live AI pipeline uses
   * (worker/processors/process-call.ts) so historical imports land in the
   * same reports/product-analytics views the same way live calls do.
   */
  private async linkDiscussedProducts(
    tx: Prisma.TransactionClient,
    callId: string,
    businessCategory: BusinessCategory,
    productsDiscussed: string[],
  ) {
    const matchedProductIds = new Set<string>();
    for (const discussed of productsDiscussed) {
      const [best] = await tx.$queryRaw<Array<{ id: string; similarity: number }>>`
        SELECT id, similarity(name, ${discussed}) AS similarity
        FROM products
        WHERE category = ${businessCategory}::business_category AND active = true
        ORDER BY similarity DESC
        LIMIT 1;
      `;
      if (best && best.similarity >= PRODUCT_MATCH_THRESHOLD) matchedProductIds.add(best.id);
    }
    if (matchedProductIds.size === 0) return;
    await tx.callProduct.createMany({
      data: Array.from(matchedProductIds).map((productId) => ({ callId, productId })),
      skipDuplicates: true,
    });
  }

  private parseCategory(value: string): BusinessCategory | null {
    const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
    if (normalized === 'car glasses') return 'car_glasses';
    if (normalized === 'car modifications' || normalized === 'car mods') return 'car_modifications';
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
