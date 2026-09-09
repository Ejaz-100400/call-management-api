import { Injectable, Logger } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Browser } from 'puppeteer-core';
import { CallsService } from '../calls/calls.service';
import { QueryCallsDto } from '../calls/dto/query-calls.dto';
import { StockService } from '../stock/stock.service';
import { STOCK_LOCATIONS, StockLocationValue } from '../stock/stock-location.util';
import { QueryStockExportDto } from './dto/query-stock-export.dto';

/**
 * Render's standard Node runtime doesn't have the system shared libraries
 * (libnss3, libatk, etc.) headless Chromium needs to actually run -- only
 * downloading the binary via `puppeteer`'s postinstall isn't enough, it
 * fails to launch with a shared-library error. @sparticuz/chromium ships a
 * build statically linked against everything it needs, purpose-built for
 * exactly this kind of minimal container (it's the standard fix for
 * Puppeteer on Render/Vercel/Lambda). Local dev keeps using the full
 * `puppeteer` package instead, since @sparticuz/chromium's binary is
 * Linux-only and won't run on a Windows/Mac dev machine.
 */
async function launchBrowser(): Promise<Browser> {
  if (process.env.RENDER) {
    const { default: chromium } = await import('@sparticuz/chromium');
    const { default: puppeteerCore } = await import('puppeteer-core');
    return puppeteerCore.launch({
      executablePath: await chromium.executablePath(),
      args: chromium.args,
      headless: true,
    });
  }
  const { default: puppeteer } = await import('puppeteer');
  return puppeteer.launch({ headless: true, args: ['--no-sandbox'] }) as unknown as Promise<Browser>;
}

const EXPORT_ROW_CAP = 10000;

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private callsService: CallsService,
    private stockService: StockService,
  ) {}

  /**
   * Reuses the exact same filter-building logic as GET /calls, so "export
   * what I'm currently looking at" works without a separate filter UI.
   * Pagination is ignored -- exports return everything matching the filter,
   * capped at EXPORT_ROW_CAP to avoid an accidental unbounded query.
   */
  private getExportRows(query: QueryCallsDto) {
    return this.callsService
      .findAll({ ...query, page: 1, pageSize: EXPORT_ROW_CAP })
      .then((result) => result.items);
  }

  async generateExcel(query: QueryCallsDto): Promise<Buffer> {
    const rows = await this.getExportRows(query);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Calls');

    sheet.columns = [
      { header: 'Call Date', key: 'callDate', width: 20 },
      { header: 'Customer Name', key: 'customerName', width: 22 },
      { header: 'Phone Number', key: 'phoneNumber', width: 16 },
      { header: 'Business Category', key: 'businessCategory', width: 18 },
      { header: 'Car Make', key: 'carMake', width: 14 },
      { header: 'Car Model', key: 'carModel', width: 14 },
      { header: 'Car Variant', key: 'carVariant', width: 14 },
      { header: 'Employee', key: 'employee', width: 18 },
      { header: 'Duration (s)', key: 'duration', width: 12 },
      { header: 'Sentiment', key: 'sentiment', width: 16 },
      { header: 'Follow-up Required', key: 'followUpRequired', width: 16 },
      { header: 'Follow-up Date', key: 'followUpDate', width: 16 },
      { header: 'Budget', key: 'budget', width: 12 },
      { header: 'Summary', key: 'summary', width: 50 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const call of rows) {
      sheet.addRow({
        callDate: call.callDate,
        customerName: call.customer?.name ?? call.extraction?.customerName ?? '',
        phoneNumber: call.customer?.phoneNumber ?? '',
        businessCategory: call.businessCategory,
        carMake: call.extraction?.carMake ?? '',
        carModel: call.extraction?.carModel ?? '',
        carVariant: call.extraction?.carVariant ?? '',
        employee: call.employee?.name ?? '',
        duration: call.durationSeconds,
        sentiment: call.extraction?.sentiment ?? '',
        followUpRequired: call.extraction?.followUpRequired ? 'Yes' : 'No',
        followUpDate: call.extraction?.followUpDate ?? '',
        budget: call.extraction?.budget ?? '',
        summary: call.extraction?.summary ?? '',
      });
    }

    const rawBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(rawBuffer as unknown as ArrayBuffer);
  }

  async generatePdf(query: QueryCallsDto): Promise<Buffer> {
    const rows = await this.getExportRows(query);
    const html = this.buildReportHtml(rows);

    let browser: Browser;
    try {
      browser = await launchBrowser();
    } catch (err) {
      this.logger.error(`Failed to launch headless browser for PDF export: ${(err as Error).message}`);
      throw err;
    }
    try {
      const page = await browser.newPage();
      // Fully self-contained inline HTML (no external resources) -- 'load'
      // is sufficient and is what puppeteer-core's stricter types accept.
      await page.setContent(html, { waitUntil: 'load' });
      const pdfBuffer = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }

  private buildReportHtml(rows: Awaited<ReturnType<ExportService['getExportRows']>>): string {
    const tableRows = rows
      .map(
        (call) => `
        <tr>
          <td>${escapeHtml(new Date(call.callDate).toLocaleString())}</td>
          <td>${escapeHtml(call.customer?.name ?? call.extraction?.customerName ?? '')}</td>
          <td>${escapeHtml(call.customer?.phoneNumber ?? '')}</td>
          <td>${escapeHtml(call.businessCategory)}</td>
          <td>${escapeHtml([call.extraction?.carMake, call.extraction?.carModel].filter(Boolean).join(' '))}</td>
          <td>${escapeHtml(call.employee?.name ?? '')}</td>
          <td>${escapeHtml(call.extraction?.sentiment ?? '')}</td>
          <td>${call.extraction?.followUpRequired ? 'Yes' : 'No'}</td>
        </tr>`,
      )
      .join('');

    return `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; font-size: 11px; }
            h1 { font-size: 16px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
            th { background: #f0f0f0; }
          </style>
        </head>
        <body>
          <h1>Call Report -- generated ${new Date().toLocaleString()}</h1>
          <table>
            <thead>
              <tr>
                <th>Call Date</th><th>Customer</th><th>Phone</th><th>Category</th>
                <th>Vehicle</th><th>Employee</th><th>Sentiment</th><th>Follow-up</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </body>
      </html>`;
  }

  /**
   * Reuses StockService.findAllItems() -- the exact same per-location
   * on-hand quantities the Stock Items page itself shows, so "export what
   * I'm looking at" holds here too. One row per item with a column per
   * location gives the branch+category breakdown in a single flat table,
   * rather than requiring a separate report per branch. `location` is
   * deliberately not forwarded -- it's export-only (which columns render),
   * not an item filter, so leaving it out here doesn't shrink the row set.
   */
  private getStockExportRows(query: QueryStockExportDto) {
    const { category, productId, search, active } = query;
    return this.stockService.findAllItems({ category, productId, search, active });
  }

  // Unset/empty `location` means "all locations", same as every other
  // multi-select filter in this app -- STOCK_LOCATIONS is the fallback.
  private resolveLocations(query: QueryStockExportDto): StockLocationValue[] {
    return query.location?.length ? query.location : [...STOCK_LOCATIONS];
  }

  async generateStockExcel(query: QueryStockExportDto): Promise<Buffer> {
    const rows = await this.getStockExportRows(query);
    const locations = this.resolveLocations(query);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Stock');

    sheet.columns = [
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Unit', key: 'unit', width: 10 },
      { header: 'Price', key: 'price', width: 12 },
      ...locations.map((loc) => ({ header: STOCK_LOCATION_LABELS[loc], key: loc, width: 16 })),
      { header: 'Reorder At', key: 'reorderThreshold', width: 12 },
      { header: 'Low Stock', key: 'lowStock', width: 12 },
      { header: 'Active', key: 'active', width: 10 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const item of rows) {
      const quantityByLocation = Object.fromEntries(
        item.quantities.filter((q) => locations.includes(q.location)).map((q) => [q.location, q.quantity]),
      );
      sheet.addRow({
        name: item.name,
        category: CATEGORY_LABELS[item.category] ?? item.category,
        unit: item.unit,
        price: item.price != null ? Number(item.price) : '',
        ...quantityByLocation,
        reorderThreshold: item.reorderThreshold,
        lowStock: item.quantities.some((q) => locations.includes(q.location) && q.lowStock) ? 'Yes' : 'No',
        active: item.active ? 'Yes' : 'No',
      });
    }

    const rawBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(rawBuffer as unknown as ArrayBuffer);
  }

  async generateStockPdf(query: QueryStockExportDto): Promise<Buffer> {
    const rows = await this.getStockExportRows(query);
    const locations = this.resolveLocations(query);
    const html = this.buildStockReportHtml(rows, locations);

    let browser: Browser;
    try {
      browser = await launchBrowser();
    } catch (err) {
      this.logger.error(`Failed to launch headless browser for PDF export: ${(err as Error).message}`);
      throw err;
    }
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdfBuffer = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }

  private buildStockReportHtml(rows: Awaited<ReturnType<ExportService['getStockExportRows']>>, locations: StockLocationValue[]): string {
    const tableRows = rows
      .map((item) => {
        const quantityByLocation = new Map(item.quantities.map((q) => [q.location, q]));
        const locationCells = locations
          .map((loc) => {
            const q = quantityByLocation.get(loc);
            const low = q?.lowStock;
            return `<td${low ? ' style="color:#c0392b;font-weight:bold;"' : ''}>${q?.quantity ?? 0}</td>`;
          })
          .join('');
        return `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(CATEGORY_LABELS[item.category] ?? item.category)}</td>
          <td>${escapeHtml(item.unit)}</td>
          ${locationCells}
          <td>${item.reorderThreshold}</td>
        </tr>`;
      })
      .join('');

    const locationHeaders = locations.map((loc) => `<th>${STOCK_LOCATION_LABELS[loc]}</th>`).join('');

    return `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; font-size: 11px; }
            h1 { font-size: 16px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
            th { background: #f0f0f0; }
          </style>
        </head>
        <body>
          <h1>Stock Report -- generated ${new Date().toLocaleString()}</h1>
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Category</th><th>Unit</th>
                ${locationHeaders}
                <th>Reorder At</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </body>
      </html>`;
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  car_glasses: 'Car Glasses',
  car_modifications: 'Car Modifications',
  unknown: 'Unknown',
};

const STOCK_LOCATION_LABELS: Record<(typeof STOCK_LOCATIONS)[number], string> = {
  ambattur: 'Ambattur (HQ)',
  kattankulathur: 'Kattankulathur',
  sithalapakkam: 'Sithalapakkam',
  pondicherry: 'Pondicherry',
  warehouse: 'Warehouse',
};

// Extraction fields (customer name, employee name, etc.) come from AI-parsed
// call transcripts, which is effectively untrusted external input by the
// time it lands here -- escape before interpolating into HTML that Puppeteer
// renders (and executes script in) to build the PDF.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
