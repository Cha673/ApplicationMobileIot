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

function parseTelemetry(raw: unknown, topic: string): Measurement | null {
  if (!raw || typeof raw !== 'object') {
    logger.warn('telemetry.rejected', { topic, reason: 'not_an_object', status: 'rejected' });
    return null;
  }

  const msg = raw as Record<string, unknown>;
  const deviceId = typeof msg['device_id'] === 'string' ? msg['device_id'] : undefined;
  const messageId = typeof msg['message_id'] === 'string' ? msg['message_id'] : undefined;

  if (typeof msg['message_id'] !== 'string') {
    logger.warn('telemetry.rejected', { topic, deviceId, reason: 'missing_message_id', status: 'rejected' });
    return null;
  }
  if (typeof msg['device_id'] !== 'string') {
    logger.warn('telemetry.rejected', { topic, messageId, reason: 'missing_device_id', status: 'rejected' });
    return null;
  }
  if (typeof msg['room_id'] !== 'string') {
    logger.warn('telemetry.rejected', { topic, deviceId, eventId: messageId, reason: 'missing_room_id', status: 'rejected' });
    return null;
  }
  if (typeof msg['observed_at'] !== 'string') {
    logger.warn('telemetry.rejected', { topic, deviceId, eventId: messageId, reason: 'missing_observed_at', status: 'rejected' });
    return null;
  }

  const temp = msg['temperature'] as Record<string, unknown> | undefined;
  const co2 = msg['co2'] as Record<string, unknown> | undefined;

  if (!temp || typeof temp['value'] !== 'number') {
    logger.warn('telemetry.rejected', { topic, deviceId, eventId: messageId, reason: 'invalid_temperature', status: 'rejected' });
    return null;
  }
  if (!co2 || typeof co2['value'] !== 'number') {
    logger.warn('telemetry.rejected', { topic, deviceId, eventId: messageId, reason: 'invalid_co2', status: 'rejected' });
    return null;
  }

  return {
    messageId: msg['message_id'] as string,
    deviceId: msg['device_id'] as string,
    roomId: msg['room_id'] as string,
    observedAt: msg['observed_at'] as string,
    receivedAt: new Date().toISOString(),
    temperature: temp['value'] as number,
    co2: co2['value'] as number,
  };
}
