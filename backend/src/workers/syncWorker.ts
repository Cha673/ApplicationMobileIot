import { Worker } from 'bullmq';
import type { TelemetryService } from '../application/telemetryService';
import { logger } from '../infrastructure/logger';

export function startSyncWorker(
  redis: { host: string; port: number },
  service: TelemetryService,
): Worker {
  const worker = new Worker(
    'sync',
    async () => {
      await service.syncBatch();
    },
    {
      connection: redis,
      concurrency: 1, // séquentiel — ordre garanti, pas de doublon dans PG
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('sync.job_failed', { jobId: job?.id, error: String(err) });
  });

  return worker;
}
