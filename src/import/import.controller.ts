import { BadRequestException, Controller, Get, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { User } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ImportService } from './import.service';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@Controller('import')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Get('calls/template')
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.importService.generateTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="historical-calls-template.xlsx"',
    });
    res.send(buffer);
  }

  @Post('calls')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async importCalls(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: User) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.importService.importFromExcel(file.buffer, user.id);
  }
}
