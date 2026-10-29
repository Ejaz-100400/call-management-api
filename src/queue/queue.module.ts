import { Global, Module } from '@nestjs/common';
import { PendingCallsSweeperService } from './pending-calls-sweeper.service';
import { QueueService } from './queue.service';

@Global()
@Module({
  providers: [QueueService, PendingCallsSweeperService],
  exports: [QueueService],
})
export class QueueModule {}
