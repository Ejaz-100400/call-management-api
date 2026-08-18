import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { RetryStuckRecordingsService } from './retry-stuck-recordings.service';

@Global()
@Module({
  providers: [QueueService, RetryStuckRecordingsService],
  exports: [QueueService],
})
export class QueueModule {}
