import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { BulkDeleteCustomersDto } from './dto/bulk-delete-customers.dto';
import { CustomersService } from './customers.service';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  findAll(@Query() query: QueryCustomersDto) {
    return this.customersService.findAll(query);
  }

  // Must be registered before ':id' so "duplicates" isn't matched as an id.
  @Get('duplicates')
  @Roles('admin', 'manager')
  findDuplicates() {
    return this.customersService.findDuplicates();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.findOne(id);
  }

  @Get(':id/calls')
  findCalls(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.findCalls(id);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(id, dto);
  }

  @Post('duplicates/:id/merge')
  @Roles('admin')
  merge(@Param('id', ParseUUIDPipe) duplicateId: string, @Body('canonicalId', ParseUUIDPipe) canonicalId: string) {
    return this.customersService.merge(duplicateId, canonicalId);
  }

  @Post('bulk-delete')
  @Roles('admin')
  removeMany(@Body() dto: BulkDeleteCustomersDto) {
    return this.customersService.removeMany(dto.ids);
  }
}
