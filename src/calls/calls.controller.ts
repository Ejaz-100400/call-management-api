import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BulkDeleteCallsDto } from './dto/bulk-delete-calls.dto';
import { CallsService } from './calls.service';
import { QueryCallsDto } from './dto/query-calls.dto';
import { UpdateCallDto } from './dto/update-call.dto';
import { UpdateExtractionDto } from './dto/update-extraction.dto';

@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  // GET /calls?search=&phone=&carMake=&carModel=&sentiment=&followUpRequired=&category=&dateFrom=&dateTo=&employeeId=
  @Get()
  findAll(@Query() query: QueryCallsDto) {
    return this.callsService.findAll(query);
  }

  // Must be registered before ':id' so these literal segments aren't matched as an id.
  @Get('car-makes')
  carMakes() {
    return this.callsService.distinctCarMakes();
  }

  @Get('car-models')
  carModels(@Query('carMake') carMake?: string) {
    return this.callsService.distinctCarModels(carMake);
  }

  @Get('duplicates')
  @Roles('admin', 'manager')
  findDuplicates() {
    return this.callsService.findDuplicates();
  }

  @Post('duplicates/:id/merge')
  @Roles('admin')
  mergeCalls(@Param('id', ParseUUIDPipe) duplicateId: string, @Body('canonicalId', ParseUUIDPipe) canonicalId: string, @CurrentUser() user: User) {
    return this.callsService.mergeCalls(duplicateId, canonicalId, user.id);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.callsService.findOne(id);
  }

  @Get(':id/recording')
  getRecording(@Param('id', ParseUUIDPipe) id: string) {
    return this.callsService.getRecordingUrl(id);
  }

  @Patch(':id')
  @Roles('admin')
  updateCall(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCallDto, @CurrentUser() user: User) {
    return this.callsService.updateCall(id, dto, user.id);
  }

  @Patch(':id/extraction')
  @Roles('admin', 'manager')
  updateExtraction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExtractionDto,
    @CurrentUser() user: User,
  ) {
    return this.callsService.updateExtraction(id, dto, user.id);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.callsService.remove(id, user.id);
  }

  @Post('bulk-delete')
  @Roles('admin')
  removeMany(@Body() dto: BulkDeleteCallsDto, @CurrentUser() user: User) {
    return this.callsService.removeMany(dto.ids, user.id);
  }

  @Post(':id/reprocess')
  @Roles('admin', 'manager')
  reprocess(@Param('id', ParseUUIDPipe) id: string) {
    return this.callsService.reprocess(id);
  }

  @Get(':id/processing-status')
  getProcessingStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.callsService.getProcessingStatus(id);
  }

  @Post(':id/extraction/regenerate-summary')
  @Roles('admin', 'manager')
  regenerateSummary(@Param('id', ParseUUIDPipe) id: string) {
    return this.callsService.regenerateSummary(id);
  }
}
