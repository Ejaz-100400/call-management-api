import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { BusinessNumbersModule } from './business-numbers/business-numbers.module';
import { CallsModule } from './calls/calls.module';
import { CustomersModule } from './customers/customers.module';
import { EmployeesModule } from './employees/employees.module';
import { ExportModule } from './export/export.module';
import { FollowUpsModule } from './follow-ups/follow-ups.module';
import { HealthController } from './health/health.controller';
import { ImportModule } from './import/import.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { QueueModule } from './queue/queue.module';
import { ReportsModule } from './reports/reports.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    PrismaModule,
    QueueModule,
    AuthModule,
    CallsModule,
    CustomersModule,
    EmployeesModule,
    ProductsModule,
    FollowUpsModule,
    ReportsModule,
    ExportModule,
    ImportModule,
    BusinessNumbersModule,
    WebhooksModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
