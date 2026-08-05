import 'dotenv/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { CALL_PROCESSING_QUEUE } from '../queue/queue.service';
import { processCallJob } from './processors/process-call';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  CALL_PROCESSING_QUEUE,
  async (job) => {
    console.log(`[worker] processing job ${job.id} (${job.name}) for call ${job.data.callId}`);
    await processCallJob(job.data);
  },
  { connection, concurrency: 2 },
);

worker.on('completed', (job) => console.log(`[worker] job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} failed:`, err.message));

console.log('[worker] listening for call-processing jobs...');
