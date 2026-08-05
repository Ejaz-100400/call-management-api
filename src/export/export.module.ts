import { Module } from '@nestjs/common';
import { CallsModule } from '../calls/calls.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [CallsModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
