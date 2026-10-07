import fs from 'fs';
import path from 'path';
import { Queue } from 'bullmq';
import {
  createPool,
  runMigrations,
  PgMeasurementRepository,
  PgDeviceRepository,
  PgEventRepository,
  PgCommandRepository,
} from './infrastructure/database';
import { createMongoClient, initMongo, MongoMeasurementRepository, MongoRawEventRepository } from './infrastructure/mongo';
import { FallbackMeasurementRepository } from './infrastructure/fallback';
import { connectMqtt } from './infrastructure/mqtt';
import { createHttpServer } from './infrastructure/http';
import { TelemetryService } from './application/telemetryService';
import { CommandService } from './application/commandService';
import { startIngestWorker } from './workers/ingestWorker';
import { startSyncWorker } from './workers/syncWorker';
import { logger } from './infrastructure/logger';

const MQTT_HOST     = process.env['MQTT_HOST']     ?? 'localhost';
const MQTT_PORT     = parseInt(process.env['MQTT_PORT']     ?? '1883', 10);
const MQTT_USER     = process.env['MQTT_USER']     ?? 'backend';
const MQTT_PASSWORD = process.env['MQTT_PASSWORD'] ?? 'backend-demo';
const API_PORT      = parseInt(process.env['API_PORT']      ?? '3000', 10);
const DEVICES_PATH        = process.env['DEVICES_PATH']        ?? path.join(process.cwd(), 'devices.json');
const REDIS_HOST          = process.env['REDIS_HOST']          ?? 'localhost';
const REDIS_PORT          = parseInt(process.env['REDIS_PORT']          ?? '6379', 10);
const COMMAND_TIMEOUT_MS  = parseInt(process.env['COMMAND_TIMEOUT_MS']  ?? '30000', 10);
const INGEST_CONCURRENCY  = parseInt(process.env['INGEST_CONCURRENCY']  ?? '20', 10);

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
  const pgCommands     = new PgCommandRepository(pool);

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

  const queueDefaults = {
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: { count: 500 },
    },
  };

  // Queue 1 : MQTT → MongoDB (réception + validation)
  const ingestQueue = new Queue('ingest', { connection: redis, ...queueDefaults });

  // Queue 2 : MongoDB → PostgreSQL (synchronisation)
  const syncQueue = new Queue('sync', { connection: redis, ...queueDefaults });

  startIngestWorker(redis, service, syncQueue, INGEST_CONCURRENCY);
  startSyncWorker(redis, service);

  logger.info('workers.started', { redis: `${REDIS_HOST}:${REDIS_PORT}` });

  // Use a late-bound handler so CommandService can be created after the client
  let handleAck: (topic: string, payload: string) => Promise<void> = () => Promise.resolve();

  const mqttClient = connectMqtt(
    MQTT_HOST, MQTT_PORT, MQTT_USER, MQTT_PASSWORD,
    ingestQueue, service,
    (topic, payload) => handleAck(topic, payload),
  );

  const commandService = new CommandService(
    pgCommands,
    (topic, payload) => { mqttClient.publish(topic, payload, { qos: 1 }); },
    COMMAND_TIMEOUT_MS,
  );
  handleAck = (topic, payload) => commandService.handleAck(topic, payload);
  commandService.startTimeoutChecker();

  const app = createHttpServer(deviceRepo, readMeasurements, commandService);
  app.listen(API_PORT, '0.0.0.0', () => {
    logger.info('http.listening', { port: API_PORT });
  });
}

main().catch((err) => {
  logger.error('fatal', { error: String(err) });
  process.exit(1);
});
