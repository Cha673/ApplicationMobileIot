import { Worker, Queue } from 'bullmq';
import type { TelemetryService } from '../application/telemetryService';
import { logger } from '../infrastructure/logger';

export function startIngestWorker(
  redis: { host: string; port: number },
  service: TelemetryService,
  syncQueue: Queue,
  concurrency = 20,
): Worker {
  const worker = new Worker(
    'ingest',
    async (job) => {
      const { topic, payload } = job.data as { topic: string; payload: string };

      await service.ingestOne(topic, payload, async () => {
        // jobId fixe = BullMQ déduplique : si un trigger est déjà en attente,
        // le nouveau est ignoré. Le worker sync traite tous les messages accumulés en un seul batch.
        await syncQueue.add('trigger', {}, {
          jobId: 'sync-singleton',
          delay: 2000,
          removeOnComplete: true,
        });
      });
    },
    {
      connection: redis,
      concurrency,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('ingest.job_failed', { jobId: job?.id, error: String(err) });
  });

  return worker;
}
