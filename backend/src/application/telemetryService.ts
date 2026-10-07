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

const BATCH_SIZE = parseInt(process.env['SYNC_BATCH_SIZE'] ?? '1000', 10);

export class TelemetryService {
  constructor(
    private readonly rawEvents: RawEventRepository,
    private readonly rawMeasurements: SyncableMeasurementRepository,
    private readonly measurements: MeasurementRepository,
    private readonly devices: DeviceRepository,
    private readonly events: EventRepository,
  ) {}

  // Called by ingestWorker — saves raw, validates, writes to MongoDB measurements.
  // onValidated is called only when the message is accepted, to trigger the sync queue.
  async ingestOne(topic: string, payload: string, onValidated: () => Promise<void>): Promise<void> {
    const receivedAt = new Date().toISOString();
    const id = await this.rawEvents.save(topic, payload, receivedAt);
    const processedAt = new Date().toISOString();

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      logger.error('raw.parse_error', { id, topic, reason: 'invalid_json' });
      await this.rawEvents.markRejected(id, 'invalid_json', processedAt);
      await this.events.saveRejection({ topic, reason: 'invalid_json' }).catch((err) =>
        logger.warn('events.save_rejection_failed', { error: String(err) }),
      );
      return;
    }

    const eventId =
      typeof data['message_id'] === 'string' && data['message_id'] ? data['message_id'] : id;

    const result = parseTelemetry(data, topic, eventId);

    if (!result.ok) {
      logger.warn('raw.rejected', { ...result.rejection, status: 'rejected' });
      await this.rawEvents.markRejected(id, result.rejection.reason, processedAt);
      await this.events.saveRejection(result.rejection).catch((err) =>
        logger.warn('events.save_rejection_failed', { error: String(err) }),
      );
      return;
    }

    const msg = result.measurement;
    const topicDeviceId = deviceIdFromTelemetryTopic(topic);
    if (topicDeviceId === null) {
      await rejectTelemetry(this.rawEvents, this.events, id, processedAt, topic, eventId, 'invalid_telemetry_topic');
      return;
    }

    if (msg.deviceId !== topicDeviceId) {
      await rejectTelemetry(
        this.rawEvents,
        this.events,
        id,
        processedAt,
        topic,
        eventId,
        'device_identity_mismatch',
        msg.deviceId,
      );
      return;
    }

    const registeredDevice = await this.devices.findById(topicDeviceId);
    if (registeredDevice === null) {
      await rejectTelemetry(this.rawEvents, this.events, id, processedAt, topic, eventId, 'unknown_device', topicDeviceId);
      return;
    }

    if (msg.roomId !== registeredDevice.roomId) {
      await rejectTelemetry(
        this.rawEvents,
        this.events,
        id,
        processedAt,
        topic,
        eventId,
        'room_assignment_mismatch',
        msg.roomId,
      );
      return;
    }

    if (await this.rawMeasurements.existsById(msg.messageId)) {
      logger.warn('raw.duplicate', {
        topic,
        deviceId: msg.deviceId,
        messageId: msg.messageId,
        status: 'skipped',
      });
      await this.rawEvents.markDuplicate(id, processedAt);
      await this.events
        .saveDuplicate({ topic, deviceId: msg.deviceId, messageId: msg.messageId })
        .catch((err) => logger.warn('events.save_duplicate_failed', { error: String(err) }));
      return;
    }

    await this.rawMeasurements.save(msg);
    await this.devices.updateTelemetrySeen(msg.deviceId, msg.observedAt);
    await this.rawEvents.markAccepted(id, processedAt);
    logger.info('raw.accepted', {
      topic,
      deviceId: msg.deviceId,
      eventId: msg.messageId,
      temperature: msg.temperature,
      co2: msg.co2,
      status: 'accepted',
    });

    await onValidated();
  }

  // Called by syncWorker — copies unsynced measurements from MongoDB to PostgreSQL.
  async syncBatch(): Promise<void> {
    const batch = await this.rawMeasurements.findUnsynced(BATCH_SIZE);
    if (batch.length === 0) return;

    try {
      await this.measurements.saveBatch(batch);
      await this.rawMeasurements.markSyncedBatch(batch.map((m) => m.messageId));
      logger.info('sync.batch_ok', { count: batch.length, eventIds: batch.map((m) => m.messageId) });
    } catch (err) {
      logger.warn('sync.batch_failed', { count: batch.length, error: String(err) });
    }
  }

  async processAvailability(
    deviceId: string,
    status: 'online' | 'offline',
    topic: string,
  ): Promise<void> {
    await this.devices.updateStatus(deviceId, status === 'online', new Date().toISOString());
    logger.info('availability.updated', { topic, deviceId, status });
  }

  async processState(deviceId: string, ventilation: boolean, topic: string): Promise<void> {
    await this.devices.updateVentilation(deviceId, ventilation);
    logger.info('state.updated', { topic, deviceId, ventilation });
  }
}

async function rejectTelemetry(
  rawEvents: RawEventRepository,
  events: EventRepository,
  id: string,
  processedAt: string,
  topic: string,
  eventId: string,
  reason: string,
  deviceId?: string,
): Promise<void> {
  await rawEvents.markRejected(id, reason, processedAt);
  await events.saveRejection({ topic, eventId, deviceId, reason }).catch((err) =>
    logger.warn('events.save_rejection_failed', { error: String(err) }),
  );
  logger.warn('raw.rejected', { topic, eventId, deviceId, reason, status: 'rejected' });
}

const TEMP_MIN = -50,
  TEMP_MAX = 100;
const CO2_MIN = 0,
  CO2_MAX = 5000;

const TelemetrySchema = z.object({
  message_id: z.string(),
  device_id: z.string(),
  room_id: z.string(),
  observed_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'invalid date'),
  temperature: z.object({ value: z.number() }),
  co2: z.object({ value: z.number() }),
});

type ParseResult =
  | { ok: true; measurement: Measurement }
  | { ok: false; rejection: RejectedEvent };

function zodReasonFor(path: (string | number)[]): string {
  switch (path[0]) {
    case 'message_id':
      return 'missing_message_id';
    case 'device_id':
      return 'missing_device_id';
    case 'room_id':
      return 'missing_room_id';
    case 'observed_at':
      return 'missing_observed_at';
    case 'temperature':
      return 'invalid_temperature';
    case 'co2':
      return 'invalid_co2';
    default:
      return 'invalid_payload';
  }
}

function deviceIdFromTelemetryTopic(topic: string): string | null {
  const parts = topic.split('/');
  return parts.length === 5 &&
    parts[0] === 'campus' &&
    parts[1] === 'v1' &&
    parts[2] === 'devices' &&
    parts[4] === 'telemetry' &&
    parts[3].length > 0
    ? parts[3]
    : null;
}

function parseTelemetry(raw: unknown, topic: string, eventId: string): ParseResult {
  const result = TelemetrySchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, rejection: { topic, eventId, reason: zodReasonFor(issue.path) } };
  }

  const { message_id, device_id, room_id, observed_at, temperature, co2 } = result.data;
  const tempVal = temperature.value;
  const co2Val = co2.value;

  if (tempVal < TEMP_MIN || tempVal > TEMP_MAX) {
    return {
      ok: false,
      rejection: {
        topic,
        deviceId: device_id,
        eventId,
        reason: 'value_out_of_range',
        field: 'temperature',
        value: tempVal,
        min: TEMP_MIN,
        max: TEMP_MAX,
      },
    };
  }

  if (co2Val < CO2_MIN || co2Val > CO2_MAX) {
    return {
      ok: false,
      rejection: {
        topic,
        deviceId: device_id,
        eventId,
        reason: 'value_out_of_range',
        field: 'co2',
        value: co2Val,
        min: CO2_MIN,
        max: CO2_MAX,
      },
    };
  }

  return {
    ok: true,
    measurement: {
      messageId: message_id,
      deviceId: device_id,
      roomId: room_id,
      observedAt: observed_at,
      receivedAt: new Date().toISOString(),
      temperature: tempVal,
      co2: co2Val,
    },
  };
}
