import { Pool } from '../../node_modules/@types/pg';
import type { MeasurementRepository, DeviceRepository } from '../domain/repositories';
import type { Measurement, Device } from '../domain/types';

export function createPool(): Pool {
  return new Pool({
    host: process.env['POSTGRES_HOST'] ?? 'localhost',
    port: parseInt(process.env['POSTGRES_PORT'] ?? '5432', 10),
    database: process.env['POSTGRES_DB'] ?? 'campus',
    user: process.env['POSTGRES_USER'] ?? 'campus',
    password: process.env['POSTGRES_PASSWORD'] ?? 'campus-demo',
  });
}

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS measurements (
      message_id   TEXT PRIMARY KEY,
      device_id    TEXT NOT NULL,
      room_id      TEXT NOT NULL,
      observed_at  TEXT NOT NULL,
      received_at  TEXT NOT NULL,
      temperature  REAL NOT NULL,
      co2          REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      device_id    TEXT PRIMARY KEY,
      room_id      TEXT NOT NULL DEFAULT '',
      label        TEXT NOT NULL DEFAULT '',
      is_online    BOOLEAN NOT NULL DEFAULT false,
      last_seen_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_measurements_device_observed
      ON measurements (device_id, observed_at DESC);
  `);
}

export class PgMeasurementRepository implements MeasurementRepository {
  constructor(private readonly pool: Pool) {}

  async save(m: Measurement): Promise<void> {
    await this.pool.query(
      `INSERT INTO measurements (message_id, device_id, room_id, observed_at, received_at, temperature, co2)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (message_id) DO NOTHING`,
      [m.messageId, m.deviceId, m.roomId, m.observedAt, m.receivedAt, m.temperature, m.co2],
    );
  }

  async existsById(messageId: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM measurements WHERE message_id = $1',
      [messageId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findLatestByDevice(deviceId: string): Promise<Measurement | null> {
    const result = await this.pool.query(
      'SELECT * FROM measurements WHERE device_id = $1 ORDER BY observed_at DESC LIMIT 1',
      [deviceId],
    );
    return result.rows[0] ? toMeasurement(result.rows[0]) : null;
  }

  async findHistoryByDevice(deviceId: string, limit: number): Promise<Measurement[]> {
    const result = await this.pool.query(
      'SELECT * FROM measurements WHERE device_id = $1 ORDER BY observed_at DESC LIMIT $2',
      [deviceId, limit],
    );
    return result.rows.map(toMeasurement);
  }
}

export class PgDeviceRepository implements DeviceRepository {
  constructor(private readonly pool: Pool) {}

  async seedIfAbsent(deviceId: string, roomId: string, label: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO devices (device_id, room_id, label, is_online, last_seen_at)
       VALUES ($1, $2, $3, false, NULL)
       ON CONFLICT (device_id) DO NOTHING`,
      [deviceId, roomId, label],
    );
  }

  async updateStatus(deviceId: string, isOnline: boolean, lastSeenAt: string): Promise<void> {
    await this.pool.query(
      'UPDATE devices SET is_online = $1, last_seen_at = $2 WHERE device_id = $3',
      [isOnline, lastSeenAt, deviceId],
    );
  }

  async findAll(): Promise<Device[]> {
    const result = await this.pool.query('SELECT * FROM devices');
    return result.rows.map(toDevice);
  }

  async findById(deviceId: string): Promise<Device | null> {
    const result = await this.pool.query(
      'SELECT * FROM devices WHERE device_id = $1',
      [deviceId],
    );
    return result.rows[0] ? toDevice(result.rows[0]) : null;
  }
}

function toMeasurement(r: Record<string, unknown>): Measurement {
  return {
    messageId: r['message_id'] as string,
    deviceId: r['device_id'] as string,
    roomId: r['room_id'] as string,
    observedAt: r['observed_at'] as string,
    receivedAt: r['received_at'] as string,
    temperature: r['temperature'] as number,
    co2: r['co2'] as number,
  };
}

function toDevice(r: Record<string, unknown>): Device {
  return {
    deviceId: r['device_id'] as string,
    roomId: r['room_id'] as string,
    label: r['label'] as string,
    isOnline: r['is_online'] as boolean,
    lastSeenAt: r['last_seen_at'] as string | null,
  };
}
