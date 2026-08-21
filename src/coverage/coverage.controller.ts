import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CoverageService } from './coverage.service';
import { CreateCoverageDto } from './dto/create-coverage.dto';
import { UpdateCoverageDto } from './dto/update-coverage.dto';

@Controller('coverage')
export class CoverageController {
  constructor(private readonly coverageService: CoverageService) {}

  @Get()
  findAll() {
    return this.coverageService.findAll();
  }

  // Admin-only: getting this wrong silently misroutes calls, same reasoning
  // as Business Numbers.
  @Post()
  @Roles('admin')
  create(@Body() dto: CreateCoverageDto) {
    return this.coverageService.create(dto);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCoverageDto) {
    return this.coverageService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.coverageService.remove(id);
  }
}
