import fs from 'fs';
import path from 'path';
import {
  createPool,
  runMigrations,
  PgMeasurementRepository,
  PgDeviceRepository,
} from './infrastructure/database';
import { connectMqtt } from './infrastructure/mqtt';
import { createHttpServer } from './infrastructure/http';
import { TelemetryService } from './application/telemetryService';

const MQTT_HOST = process.env['MQTT_HOST'] ?? 'localhost';
const MQTT_PORT = parseInt(process.env['MQTT_PORT'] ?? '1883', 10);
const MQTT_USER = process.env['MQTT_USER'] ?? 'backend';
const MQTT_PASSWORD = process.env['MQTT_PASSWORD'] ?? 'backend-demo';
const API_PORT = parseInt(process.env['API_PORT'] ?? '3000', 10);
const DEVICES_PATH = process.env['DEVICES_PATH'] ?? path.join(process.cwd(), 'devices.json');

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
    console.log(`[init] seeded ${list.length} devices from ${DEVICES_PATH}`);
  } catch (err) {
    console.warn('[init] could not seed devices:', err);
  }
}

async function main(): Promise<void> {
  const pool = createPool();
  await runMigrations(pool);

  const measurementRepo = new PgMeasurementRepository(pool);
  const deviceRepo = new PgDeviceRepository(pool);

  await seedDevices(deviceRepo);

  const service = new TelemetryService(measurementRepo, deviceRepo);

  connectMqtt(MQTT_HOST, MQTT_PORT, MQTT_USER, MQTT_PASSWORD, service);

  const app = createHttpServer(deviceRepo, measurementRepo);
  app.listen(API_PORT, '0.0.0.0', () => {
    console.log(`[http] API listening on port ${API_PORT}`);
  });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
