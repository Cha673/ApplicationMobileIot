import fs from 'fs';
import path from 'path';
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
import { logger } from './infrastructure/logger';

const MQTT_HOST = process.env['MQTT_HOST'] ?? 'localhost';
const MQTT_PORT = parseInt(process.env['MQTT_PORT'] ?? '1883', 10);
const MQTT_USER = process.env['MQTT_USER'] ?? 'backend';
const MQTT_PASSWORD = process.env['MQTT_PASSWORD'] ?? 'backend-demo';
const API_PORT = parseInt(process.env['API_PORT'] ?? '3000', 10);
const DEVICES_PATH = process.env['DEVICES_PATH'] ?? path.join(process.cwd(), 'devices.json');
const SYNC_INTERVAL_MS = parseInt(process.env['SYNC_INTERVAL_MS'] ?? '5000', 10);

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
  // Relational DB (PostgreSQL) — source of truth for validated reads
  const pool = createPool();
  await runMigrations(pool);
  const pgMeasurements = new PgMeasurementRepository(pool);
  const deviceRepo = new PgDeviceRepository(pool);
  const eventRepo = new PgEventRepository(pool);

  // Non-relational DB (MongoDB) — raw ingest and offline cache
  const mongoClient = createMongoClient();
  await mongoClient.connect();
  const mongoDB = await initMongo(mongoClient);
  const mongoMeasurements = new MongoMeasurementRepository(mongoDB);
  const mongoRawEvents = new MongoRawEventRepository(mongoDB);
  logger.info('init.mongodb_connected');

  // Reads use PostgreSQL with automatic fallback to MongoDB when PG is unavailable
  const readMeasurements = new FallbackMeasurementRepository(pgMeasurements, mongoMeasurements);

  await seedDevices(deviceRepo);

  // Write path: raw → mongo raw_events → mongo measurements → postgres
  const service = new TelemetryService(mongoRawEvents, mongoMeasurements, pgMeasurements, deviceRepo, eventRepo);

  service.startSyncLoop(SYNC_INTERVAL_MS);

  connectMqtt(MQTT_HOST, MQTT_PORT, MQTT_USER, MQTT_PASSWORD, service);

  const app = createHttpServer(deviceRepo, readMeasurements);
  app.listen(API_PORT, '0.0.0.0', () => {
    logger.info('http.listening', { port: API_PORT });
  });
}

main().catch((err) => {
  logger.error('fatal', { error: String(err) });
  process.exit(1);
});
