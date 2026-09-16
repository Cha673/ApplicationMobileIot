import type { SyncableMeasurementRepository, MeasurementRepository, DeviceRepository } from '../domain/repositories';
import type { Measurement } from '../domain/types';

const BATCH_SIZE = 500;

export class TelemetryService {
  constructor(
    private readonly rawMeasurements: SyncableMeasurementRepository,
    private readonly measurements: MeasurementRepository,
    private readonly devices: DeviceRepository,
  ) {}

  async processTelemetry(raw: unknown): Promise<void> {
    const msg = parseTelemetry(raw);
    if (!msg) return;

    if (await this.rawMeasurements.existsById(msg.messageId)) {
      console.log(`[telemetry] duplicate skipped: ${msg.messageId}`);
      return;
    }

    await this.rawMeasurements.save(msg);
    console.log(`[telemetry] saved to mongo: ${msg.deviceId} T=${msg.temperature}°C CO2=${msg.co2}ppm`);
  }

  async processAvailability(deviceId: string, status: 'online' | 'offline'): Promise<void> {
    await this.devices.updateStatus(deviceId, status === 'online', new Date().toISOString());
    console.log(`[availability] ${deviceId}: ${status}`);
  }

  startSyncLoop(intervalMs: number): void {
    console.log(`[sync] batch sync started — every ${intervalMs}ms, up to ${BATCH_SIZE} rows`);
    setInterval(() => {
      this.syncBatch().catch((err) => console.warn('[sync] unexpected error:', err));
    }, intervalMs);
  }

  private async syncBatch(): Promise<void> {
    const batch = await this.rawMeasurements.findUnsynced(BATCH_SIZE);
    if (batch.length === 0) return;

    try {
      await this.measurements.saveBatch(batch);
      await this.rawMeasurements.markSyncedBatch(batch.map((m) => m.messageId));
      console.log(`[sync] ${batch.length} measurements → postgres`);
    } catch (err) {
      console.warn(`[sync] postgres unavailable, ${batch.length} messages stay in mongo:`, err);
    }
  }
}

function parseTelemetry(raw: unknown): Measurement | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;

  const temp = msg['temperature'] as Record<string, unknown> | undefined;
  const co2 = msg['co2'] as Record<string, unknown> | undefined;

  if (
    typeof msg['message_id'] !== 'string' ||
    typeof msg['device_id'] !== 'string' ||
    typeof msg['room_id'] !== 'string' ||
    typeof msg['observed_at'] !== 'string' ||
    !temp || typeof temp['value'] !== 'number' ||
    !co2 || typeof co2['value'] !== 'number'
  ) {
    console.warn('[telemetry] invalid message skipped');
    return null;
  }

  return {
    messageId: msg['message_id'],
    deviceId: msg['device_id'],
    roomId: msg['room_id'],
    observedAt: msg['observed_at'],
    receivedAt: new Date().toISOString(),
    temperature: temp['value'] as number,
    co2: co2['value'] as number,
  };
}
