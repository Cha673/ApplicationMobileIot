import { z } from 'zod';
import type { SyncableMeasurementRepository, MeasurementRepository, DeviceRepository } from '../domain/repositories';
import type { Measurement } from '../domain/types';
import { logger } from '../infrastructure/logger';

const BATCH_SIZE = 500;

export class TelemetryService {
  constructor(
    private readonly rawMeasurements: SyncableMeasurementRepository,
    private readonly measurements: MeasurementRepository,
    private readonly devices: DeviceRepository,
  ) {}

  async processTelemetry(raw: unknown, topic: string): Promise<void> {
    const msg = parseTelemetry(raw, topic);
    if (!msg) return;

    if (await this.rawMeasurements.existsById(msg.messageId)) {
      logger.warn('telemetry.duplicate', {
        topic,
        deviceId: msg.deviceId,
        eventId: msg.messageId,
        status: 'skipped',
      });
      return;
    }

    await this.rawMeasurements.save(msg);
    logger.info('telemetry.saved', {
      topic,
      deviceId: msg.deviceId,
      eventId: msg.messageId,
      temperature: msg.temperature,
      co2: msg.co2,
      status: 'accepted',
    });
  }

  async processAvailability(deviceId: string, status: 'online' | 'offline'): Promise<void> {
    await this.devices.updateStatus(deviceId, status === 'online', new Date().toISOString());
    logger.info('availability.updated', { deviceId, status });
  }

  startSyncLoop(intervalMs: number): void {
    logger.info('sync.started', { intervalMs, batchSize: BATCH_SIZE });
    setInterval(() => {
      this.syncBatch().catch((err) => logger.warn('sync.unexpected_error', { error: String(err) }));
    }, intervalMs);
  }

  private async syncBatch(): Promise<void> {
    const batch = await this.rawMeasurements.findUnsynced(BATCH_SIZE);
    if (batch.length === 0) return;

    try {
      await this.measurements.saveBatch(batch);
      await this.rawMeasurements.markSyncedBatch(batch.map((m) => m.messageId));
      logger.info('sync.batch_ok', { count: batch.length });
    } catch (err) {
      logger.warn('sync.batch_failed', { count: batch.length, error: String(err) });
    }
  }
}

// Physical bounds for sensor readings
const TEMP_MIN = -50, TEMP_MAX = 100;   // °C — room/building sensor range
const CO2_MIN = 0,    CO2_MAX = 5000;   // ppm — 0 impossible, 5000 dangerously high ceiling

// Zod schema — structural and type checks only; physics range is validated separately
const TelemetrySchema = z.object({
  message_id:  z.string(),
  device_id:   z.string(),
  room_id:     z.string(),
  observed_at: z.string(),
  temperature: z.object({ value: z.number() }),
  co2:         z.object({ value: z.number() }),
});

function zodReasonFor(path: (string | number)[]): string {
  switch (path[0]) {
    case 'message_id':  return 'missing_message_id';
    case 'device_id':   return 'missing_device_id';
    case 'room_id':     return 'missing_room_id';
    case 'observed_at': return 'missing_observed_at';
    case 'temperature': return 'invalid_temperature';
    case 'co2':         return 'invalid_co2';
    default:            return 'invalid_payload';
  }
}

function parseTelemetry(raw: unknown, topic: string): Measurement | null {
  const result = TelemetrySchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const reason = zodReasonFor(issue.path);
    logger.warn('telemetry.rejected', { topic, reason, status: 'rejected' });
    return null;
  }

  const { message_id, device_id, room_id, observed_at, temperature, co2 } = result.data;
  const tempVal = temperature.value;
  const co2Val  = co2.value;

  if (tempVal < TEMP_MIN || tempVal > TEMP_MAX) {
    logger.warn('telemetry.rejected', {
      topic, deviceId: device_id, eventId: message_id,
      reason: 'value_out_of_range', field: 'temperature',
      value: tempVal, min: TEMP_MIN, max: TEMP_MAX, status: 'rejected',
    });
    return null;
  }
  if (co2Val < CO2_MIN || co2Val > CO2_MAX) {
    logger.warn('telemetry.rejected', {
      topic, deviceId: device_id, eventId: message_id,
      reason: 'value_out_of_range', field: 'co2',
      value: co2Val, min: CO2_MIN, max: CO2_MAX, status: 'rejected',
    });
    return null;
  }

  return {
    messageId:   message_id,
    deviceId:    device_id,
    roomId:      room_id,
    observedAt:  observed_at,
    receivedAt:  new Date().toISOString(),
    temperature: tempVal,
    co2:         co2Val,
  };
}
