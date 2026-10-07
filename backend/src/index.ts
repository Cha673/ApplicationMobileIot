import fs from 'fs';
import path from 'path';
import { Queue } from 'bullmq';
import {
  createPool,
  runMigrations,
  PgMeasurementRepository,
  PgDeviceRepository,
  PgEventRepository,
} from './infrastructure/database';
import { createMongoClient, initMongo, MongoMeasurementRepository, MongoRawEventRepository } from './infrastructure/mongo';
import { FallbackMeasurementRepository } from './infrastructure/fallback';
import { connectMqtt } from './infrastructure/mqtt';
import { createHttpServer } from './infrastructure/http';
import { TelemetryService } from './application/telemetryService';
import { startIngestWorker } from './workers/ingestWorker';
import { startSyncWorker } from './workers/syncWorker';
import { logger } from './infrastructure/logger';

const MQTT_HOST     = process.env['MQTT_HOST']     ?? 'localhost';
const MQTT_PORT     = parseInt(process.env['MQTT_PORT']     ?? '1883', 10);
const MQTT_USER     = process.env['MQTT_USER']     ?? 'backend';
const MQTT_PASSWORD = process.env['MQTT_PASSWORD'] ?? 'backend-demo';
const API_PORT      = parseInt(process.env['API_PORT']      ?? '3000', 10);
const DEVICES_PATH  = process.env['DEVICES_PATH']  ?? path.join(process.cwd(), 'devices.json');
const REDIS_HOST    = process.env['REDIS_HOST']    ?? 'localhost';
const REDIS_PORT    = parseInt(process.env['REDIS_PORT']    ?? '6379', 10);

interface DeviceConfig {
  device_id: string;
  room_id: string;
  label: string;
}

async function seedDevices(repo: PgDeviceRepository): Promise<void> {
  try {
    const raw = fs.readFileSync(DEVICES_PATH, 'utf-8');
    const list = JSON.parse(raw) as DeviceConfig[];
    for (const d of list) {
      await repo.seedIfAbsent(d.device_id, d.room_id, d.label);
    }
    logger.info('init.devices_seeded', { count: list.length, path: DEVICES_PATH });
  } catch (err) {
    logger.warn('init.seed_failed', { error: String(err) });
  }
}

async function main(): Promise<void> {
  const pool = createPool();
  await runMigrations(pool);
  const pgMeasurements = new PgMeasurementRepository(pool);
  const deviceRepo     = new PgDeviceRepository(pool);
  const eventRepo      = new PgEventRepository(pool);

  const mongoClient = createMongoClient();
  await mongoClient.connect();
  const mongoDB          = await initMongo(mongoClient);
  const mongoMeasurements = new MongoMeasurementRepository(mongoDB);
  const mongoRawEvents    = new MongoRawEventRepository(mongoDB);
  logger.info('init.mongodb_connected');

  const readMeasurements = new FallbackMeasurementRepository(pgMeasurements, mongoMeasurements);

  await seedDevices(deviceRepo);

  const service = new TelemetryService(mongoRawEvents, mongoMeasurements, pgMeasurements, deviceRepo, eventRepo);

  // Redis connection config partagée par les deux queues et les deux workers
  const redis = { host: REDIS_HOST, port: REDIS_PORT };

  // Queue 1 : MQTT → MongoDB (réception + validation)
  const ingestQueue = new Queue('ingest', { connection: redis });

  // Queue 2 : MongoDB → PostgreSQL (synchronisation)
  const syncQueue = new Queue('sync', { connection: redis });

  startIngestWorker(redis, service, syncQueue);
  startSyncWorker(redis, service);

  logger.info('workers.started', { redis: `${REDIS_HOST}:${REDIS_PORT}` });

  const isMqttConnected = connectMqtt(
    MQTT_HOST, MQTT_PORT, MQTT_USER, MQTT_PASSWORD, ingestQueue, service,
  );

  const app = createHttpServer(deviceRepo, readMeasurements, {
    postgres: () => pool.query('SELECT 1').then(() => undefined),
    mongo: () => mongoDB.command({ ping: 1 }).then(() => undefined),
    redis: async () => {
      await ingestQueue.getJobCounts();
      await syncQueue.getJobCounts();
    },
    mqtt: isMqttConnected,
    sync: async () => {
      const result = await mongoDB.collection('measurements').find(
        { synced: false },
        { projection: { received_at: 1 }, sort: { received_at: 1 }, limit: 1 },
      ).toArray();
      const count = await mongoDB.collection('measurements').countDocuments({ synced: false });
      const oldest = result[0]?.['received_at'];
      return {
        unsyncedCount: count,
        oldestUnsyncedAt: typeof oldest === 'string' ? oldest : null,
      };
    },
  });
  app.listen(API_PORT, '0.0.0.0', () => {
    logger.info('http.listening', { port: API_PORT });
  });
}

main().catch((err) => {
  logger.error('fatal', { error: String(err) });
  process.exit(1);
});
