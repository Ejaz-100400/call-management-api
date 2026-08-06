import { Controller, Get, Query, Res } from '@nestjs/common';
import { User } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { QueryCallsDto } from '../calls/dto/query-calls.dto';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService } from './export.service';

@Controller('export')
@Roles('admin', 'manager')
export class ExportController {
  constructor(
    private readonly exportService: ExportService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('calls.xlsx')
  async exportExcel(@Query() query: QueryCallsDto, @CurrentUser() user: User, @Res() res: Response) {
    const buffer = await this.exportService.generateExcel(query);
    await this.logExport(user.id, 'xlsx', query);

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="calls-export-${this.dateStamp()}.xlsx"`,
    });
    res.send(buffer);
  }

  @Get('history')
  history() {
    return this.prisma.auditLog.findMany({
      where: { action: 'export_report' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { name: true, email: true } } },
    });
  }

  @Get('calls.pdf')
  async exportPdf(@Query() query: QueryCallsDto, @CurrentUser() user: User, @Res() res: Response) {
    const buffer = await this.exportService.generatePdf(query);
    await this.logExport(user.id, 'pdf', query);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="calls-export-${this.dateStamp()}.pdf"`,
    });
    res.send(buffer);
  }

  private dateStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  private logExport(userId: string, format: string, query: QueryCallsDto) {
    return this.prisma.auditLog.create({
      data: {
        userId,
        action: 'export_report',
        entity: 'calls',
        details: { format, filters: query } as object,
      },
    });
  }
}
