import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { QueryReportsDto } from './dto/query-reports.dto';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('summary')
  summary(@Query() filters: QueryReportsDto) {
    return this.reportsService.summary(filters);
  }

  @Get('calls-by-period')
  callsByPeriod(@Query('granularity') granularity: 'hourly' | 'daily' | 'weekly' | 'monthly' | undefined, @Query() filters: QueryReportsDto) {
    return this.reportsService.callsByPeriod(granularity, filters);
  }

  @Get('customers-by-period')
  customersByPeriod(@Query('granularity') granularity: 'daily' | 'weekly' | 'monthly' | undefined, @Query() filters: QueryReportsDto) {
    return this.reportsService.customersByPeriod(granularity, filters);
  }

  @Get('follow-ups')
  followUps(@Query() filters: QueryReportsDto) {
    return this.reportsService.followUpBreakdown(filters);
  }

  @Get('sentiment')
  sentiment(@Query() filters: QueryReportsDto) {
    return this.reportsService.sentimentBreakdown(filters);
  }

  @Get('top-car-models')
  topCarModels(@Query('limit') limit: string | undefined, @Query() filters: QueryReportsDto) {
    return this.reportsService.topCarModels(limit ? Number(limit) : undefined, filters);
  }

  @Get('top-car-makes')
  topCarMakes(@Query('limit') limit: string | undefined, @Query() filters: QueryReportsDto) {
    return this.reportsService.topCarMakes(limit ? Number(limit) : undefined, filters);
  }

  @Get('top-products')
  topProducts(@Query('limit') limit: string | undefined, @Query() filters: QueryReportsDto) {
    return this.reportsService.topProducts(limit ? Number(limit) : undefined, filters);
  }

  @Get('top-employees')
  topEmployees(@Query('limit') limit: string | undefined, @Query() filters: QueryReportsDto) {
    return this.reportsService.topEmployees(limit ? Number(limit) : undefined, filters);
  }

  @Get('branches')
  byBranch(@Query() filters: QueryReportsDto) {
    return this.reportsService.byBranch(filters);
  }

  @Get('customer-call-history')
  customerCallHistory(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query() filters: QueryReportsDto,
  ) {
    return this.reportsService.customerCallHistory(filters, page ? Number(page) : undefined, pageSize ? Number(pageSize) : undefined);
  }
}
