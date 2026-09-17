import { Pool } from 'pg';
import type { MeasurementRepository, DeviceRepository, EventRepository } from '../domain/repositories';
import type { Measurement, Device, RejectedEvent, DuplicateEvent } from '../domain/types';

export function createPool(): Pool {
  return new Pool({
    host: process.env["POSTGRES_HOST"] ?? "localhost",
    port: parseInt(process.env["POSTGRES_PORT"] ?? "5432", 10),
    database: process.env["POSTGRES_DB"] ?? "campus",
    user: process.env["POSTGRES_USER"] ?? "campus",
    password: process.env["POSTGRES_PASSWORD"] ?? "campus-demo",
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
      last_seen_at TEXT,
      last_telemetry_at TEXT
    );

    CREATE TABLE IF NOT EXISTS rejected_events (
      id          SERIAL PRIMARY KEY,
      rejected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      topic       TEXT,
      device_id   TEXT,
      message_id  TEXT,
      reason      TEXT NOT NULL,
      field       TEXT,
      value       REAL,
      min_val     REAL,
      max_val     REAL
    );

    CREATE TABLE IF NOT EXISTS duplicate_events (
      id          SERIAL PRIMARY KEY,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      topic       TEXT,
      device_id   TEXT NOT NULL,
      message_id  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_measurements_device_observed
      ON measurements (device_id, observed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_rejected_events_at
      ON rejected_events (rejected_at DESC);

    CREATE INDEX IF NOT EXISTS idx_duplicate_events_at
      ON duplicate_events (detected_at DESC);
  `);

  // Additive column migrations (idempotent)
  await pool.query(`
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_telemetry_at TEXT;
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

  async saveBatch(batch: Measurement[]): Promise<void> {
    if (batch.length === 0) return;
    const values: unknown[] = [];
    const placeholders = batch.map((m, i) => {
      const b = i * 7;
      values.push(m.messageId, m.deviceId, m.roomId, m.observedAt, m.receivedAt, m.temperature, m.co2);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
    });
    await this.pool.query(
      `INSERT INTO measurements (message_id, device_id, room_id, observed_at, received_at, temperature, co2)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (message_id) DO NOTHING`,
      values,
    );
  }

  async existsById(messageId: string): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT 1 FROM measurements WHERE message_id = $1",
      [messageId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findLatestByDevice(deviceId: string): Promise<Measurement | null> {
    const result = await this.pool.query(
      "SELECT * FROM measurements WHERE device_id = $1 ORDER BY observed_at DESC, received_at DESC, message_id DESC LIMIT 1",
      [deviceId],
    );
    return result.rows[0] ? toMeasurement(result.rows[0]) : null;
  }

  async findHistoryByDevice(deviceId: string, limit: number): Promise<Measurement[]> {
    const result = await this.pool.query(
      "SELECT * FROM measurements WHERE device_id = $1 ORDER BY observed_at DESC, received_at DESC, message_id DESC LIMIT $2",
      [deviceId, limit],
    );
    return result.rows.map(toMeasurement);
  }

  async findAverageTemperatureByDevice(deviceId: string, from: string, to: string): Promise<number | null> {
    const result = await this.pool.query(
      `SELECT AVG(temperature)::float AS average_temperature
       FROM measurements
       WHERE device_id = $1 AND observed_at >= $2 AND observed_at < $3`,
      [deviceId, from, to],
    );
    const average = result.rows[0]?.['average_temperature'];
    return typeof average === 'number' ? average : null;
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
      "UPDATE devices SET is_online = $1, last_seen_at = $2 WHERE device_id = $3",
      [isOnline, lastSeenAt, deviceId],
    );
  }

  async updateTelemetrySeen(deviceId: string, receivedAt: string): Promise<void> {
    await this.pool.query(
      "UPDATE devices SET last_telemetry_at = $1 WHERE device_id = $2",
      [receivedAt, deviceId],
    );
  }

  async findAll(): Promise<Device[]> {
    const result = await this.pool.query("SELECT * FROM devices");
    return result.rows.map(toDevice);
  }

  async findById(deviceId: string): Promise<Device | null> {
    const result = await this.pool.query(
      "SELECT * FROM devices WHERE device_id = $1",
      [deviceId],
    );
    return result.rows[0] ? toDevice(result.rows[0]) : null;
  }
}

export class PgEventRepository implements EventRepository {
  constructor(private readonly pool: Pool) {}

  async saveRejection(e: RejectedEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO rejected_events (topic, device_id, message_id, reason, field, value, min_val, max_val)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [e.topic, e.deviceId ?? null, e.eventId ?? null, e.reason,
       e.field ?? null, e.value ?? null, e.min ?? null, e.max ?? null],
    );
  }

  async saveDuplicate(e: DuplicateEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO duplicate_events (topic, device_id, message_id)
       VALUES ($1, $2, $3)`,
      [e.topic, e.deviceId, e.messageId],
    );
  }
}

function toMeasurement(r: Record<string, unknown>): Measurement {
  return {
    messageId:   r["message_id"] as string,
    deviceId:    r["device_id"] as string,
    roomId:      r["room_id"] as string,
    observedAt:  r["observed_at"] as string,
    receivedAt:  r["received_at"] as string,
    temperature: r["temperature"] as number,
    co2:         r["co2"] as number,
  };
}

function toDevice(r: Record<string, unknown>): Device {
  return {
    deviceId:       r["device_id"] as string,
    roomId:         r["room_id"] as string,
    label:          r["label"] as string,
    isOnline:       r["is_online"] as boolean,
    lastSeenAt:     r["last_seen_at"] as string | null,
    lastTelemetryAt: r["last_telemetry_at"] as string | null,
  };
}
