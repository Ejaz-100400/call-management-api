import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PerformanceService } from './performance.service';
import { QueryPerformanceDto } from './dto/query-performance.dto';

@Controller('performance')
export class PerformanceController {
  constructor(private readonly performanceService: PerformanceService) {}

  // Deliberately not an @Roles() check -- this is gated on the isOwner flag
  // specifically, not any role tier, since even other admins shouldn't see it.
  @Get('employees')
  async employeeReport(@Query() query: QueryPerformanceDto, @CurrentUser() user: User) {
    if (!user.isOwner) {
      throw new ForbiddenException('This page is restricted to the account owner');
    }
    return this.performanceService.getEmployeeReport(query.month);
  }
}
