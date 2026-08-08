import { BadRequestException, Body, Controller, Get, Post, Res, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { User } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CommitPhotoRowsDto } from './dto/commit-photo-rows.dto';
import { ImportService } from './import.service';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PHOTOS_PER_BATCH = 30;

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

  @Get('calls/history')
  history() {
    return this.importService.history();
  }

  @Post('calls')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async importCalls(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: User) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.importService.importFromExcel(file.buffer, user.id);
  }

  @Post('photos/extract')
  @UseInterceptors(FilesInterceptor('files', MAX_PHOTOS_PER_BATCH, { limits: { fileSize: MAX_PHOTO_BYTES } }))
  async extractPhotos(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException('No photos uploaded');
    return this.importService.extractFromPhotos(files);
  }

  @Post('photos/commit')
  async commitPhotoRows(@Body() dto: CommitPhotoRowsDto, @CurrentUser() user: User) {
    if (!dto.rows?.length) throw new BadRequestException('No rows to import');
    return this.importService.commitPhotoRows(dto.rows, user.id);
  }
}
