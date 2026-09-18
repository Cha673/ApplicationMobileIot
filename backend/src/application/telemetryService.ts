import { z } from 'zod';
import type {
  SyncableMeasurementRepository,
  MeasurementRepository,
  DeviceRepository,
  EventRepository,
  RawEventRepository,
} from '../domain/repositories';
import type { Measurement, RejectedEvent } from '../domain/types';
import { logger } from '../infrastructure/logger';

const BATCH_SIZE = 500;

export class TelemetryService {
  constructor(
    private readonly rawEvents: RawEventRepository,
    private readonly rawMeasurements: SyncableMeasurementRepository,
    private readonly measurements: MeasurementRepository,
    private readonly devices: DeviceRepository,
    private readonly events: EventRepository,
  ) {}

  async saveRaw(topic: string, payload: string): Promise<void> {
    const receivedAt = new Date().toISOString();
    await this.rawEvents.save(topic, payload, receivedAt);
    logger.info('mqtt.raw_stored', { topic });
  }

  async processAvailability(deviceId: string, status: 'online' | 'offline', topic: string): Promise<void> {
    await this.devices.updateStatus(deviceId, status === 'online', new Date().toISOString());
    logger.info('availability.updated', { topic, deviceId, status });
  }

  startSyncLoop(intervalMs: number): void {
    logger.info('sync.started', { intervalMs, batchSize: BATCH_SIZE });
    setInterval(() => {
      this.processRawBatch()
        .then(() => this.syncBatch())
        .catch((err) => logger.warn('sync.unexpected_error', { error: String(err) }));
    }, intervalMs);
  }

  private async processRawBatch(): Promise<void> {
    const pending = await this.rawEvents.findPending(BATCH_SIZE);
    if (pending.length === 0) return;

    for (const event of pending) {
      const processedAt = new Date().toISOString();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(event.payload) as Record<string, unknown>;
      } catch {
        logger.error('raw.parse_error', { id: event.id, topic: event.topic, reason: 'invalid_json' });
        await this.rawEvents.markRejected(event.id, 'invalid_json', processedAt);
        await this.events.saveRejection({ topic: event.topic, reason: 'invalid_json' }).catch((err) =>
          logger.warn('events.save_rejection_failed', { error: String(err) }),
        );
        continue;
      }

      const eventId = typeof data['message_id'] === 'string' && data['message_id']
        ? data['message_id']
        : event.id;

      const result = parseTelemetry(data, event.topic, eventId);

      if (!result.ok) {
        logger.warn('raw.rejected', { ...result.rejection, status: 'rejected' });
        await this.rawEvents.markRejected(event.id, result.rejection.reason, processedAt);
        await this.events.saveRejection(result.rejection).catch((err) =>
          logger.warn('events.save_rejection_failed', { error: String(err) }),
        );
        continue;
      }

      const msg = result.measurement;

      if (await this.rawMeasurements.existsById(msg.messageId)) {
        logger.warn('raw.duplicate', { topic: event.topic, deviceId: msg.deviceId, messageId: msg.messageId, status: 'skipped' });
        await this.rawEvents.markDuplicate(event.id, processedAt);
        await this.events.saveDuplicate({ topic: event.topic, deviceId: msg.deviceId, messageId: msg.messageId }).catch((err) =>
          logger.warn('events.save_duplicate_failed', { error: String(err) }),
        );
        continue;
      }

      await this.rawMeasurements.save(msg);
      await this.devices.updateTelemetrySeen(msg.deviceId, msg.receivedAt);
      await this.rawEvents.markAccepted(event.id, processedAt);
      logger.info('raw.accepted', {
        topic: event.topic,
        deviceId: msg.deviceId,
        eventId: msg.messageId,
        temperature: msg.temperature,
        co2: msg.co2,
        status: 'accepted',
      });
    }
  }

  private async syncBatch(): Promise<void> {
    const batch = await this.rawMeasurements.findUnsynced(BATCH_SIZE);
    if (batch.length === 0) return;

    try {
      await this.measurements.saveBatch(batch);
      await this.rawMeasurements.markSyncedBatch(batch.map((m) => m.messageId));
      logger.info('sync.batch_ok', { count: batch.length, eventIds: batch.map((m) => m.messageId) });
    } catch (err) {
      logger.warn('sync.batch_failed', { count: batch.length, eventIds: batch.map((m) => m.messageId), error: String(err) });
    }
  }
}

const TEMP_MIN = -50, TEMP_MAX = 100;
const CO2_MIN = 0,    CO2_MAX = 5000;

const TelemetrySchema = z.object({
  message_id:  z.string(),
  device_id:   z.string(),
  room_id:     z.string(),
  observed_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'invalid date'),
  temperature: z.object({ value: z.number() }),
  co2:         z.object({ value: z.number() }),
});

type ParseResult =
  | { ok: true;  measurement: Measurement }
  | { ok: false; rejection: RejectedEvent };

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

function parseTelemetry(raw: unknown, topic: string, eventId: string): ParseResult {
  const result = TelemetrySchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, rejection: { topic, eventId, reason: zodReasonFor(issue.path) } };
  }

  const { message_id, device_id, room_id, observed_at, temperature, co2 } = result.data;
  const tempVal = temperature.value;
  const co2Val  = co2.value;

  if (tempVal < TEMP_MIN || tempVal > TEMP_MAX) {
    return {
      ok: false,
      rejection: {
        topic, deviceId: device_id, eventId,
        reason: 'value_out_of_range', field: 'temperature',
        value: tempVal, min: TEMP_MIN, max: TEMP_MAX,
      },
    };
  }
  if (co2Val < CO2_MIN || co2Val > CO2_MAX) {
    return {
      ok: false,
      rejection: {
        topic, deviceId: device_id, eventId,
        reason: 'value_out_of_range', field: 'co2',
        value: co2Val, min: CO2_MIN, max: CO2_MAX,
      },
    };
  }

  return {
    ok: true,
    measurement: {
      messageId:   message_id,
      deviceId:    device_id,
      roomId:      room_id,
      observedAt:  observed_at,
      receivedAt:  new Date().toISOString(),
      temperature: tempVal,
      co2:         co2Val,
    },
  };
}
