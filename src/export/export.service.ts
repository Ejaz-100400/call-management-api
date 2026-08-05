import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import puppeteer from 'puppeteer';
import { CallsService } from '../calls/calls.service';
import { QueryCallsDto } from '../calls/dto/query-calls.dto';

const EXPORT_ROW_CAP = 10000;

@Injectable()
export class ExportService {
  constructor(private callsService: CallsService) {}

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

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
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
}

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
