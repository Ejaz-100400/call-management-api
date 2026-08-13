import { Module } from '@nestjs/common';
import { BusinessNumbersController } from './business-numbers.controller';
import { BusinessNumbersService } from './business-numbers.service';

@Module({
  controllers: [BusinessNumbersController],
  providers: [BusinessNumbersService],
  exports: [BusinessNumbersService],
})
export class BusinessNumbersModule {}
