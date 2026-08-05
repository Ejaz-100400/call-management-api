import { Module } from '@nestjs/common';
import { BusinessNumbersController } from './business-numbers.controller';

@Module({
  controllers: [BusinessNumbersController],
})
export class BusinessNumbersModule {}
