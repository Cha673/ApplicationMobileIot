import type { Measurement, Device, RejectedEvent, DuplicateEvent } from './types';

export interface MeasurementRepository {
  save(measurement: Measurement): Promise<void>;
  saveBatch(measurements: Measurement[]): Promise<void>;
  existsById(messageId: string): Promise<boolean>;
  findLatestByDevice(deviceId: string): Promise<Measurement | null>;
  findHistoryByDevice(deviceId: string, limit: number): Promise<Measurement[]>;
  findAverageTemperatureByDevice(
    deviceId: string,
    from: string,
    to: string,
  ): Promise<number | null>;
}

export interface SyncableMeasurementRepository extends MeasurementRepository {
  findUnsynced(limit: number): Promise<Measurement[]>;
  markSyncedBatch(messageIds: string[]): Promise<void>;
}

export interface DeviceRepository {
  seedIfAbsent(deviceId: string, roomId: string, label: string): Promise<void>;
  updateStatus(deviceId: string, isOnline: boolean, lastSeenAt: string): Promise<void>;
  findAll(): Promise<Device[]>;
  findById(deviceId: string): Promise<Device | null>;
}

export interface EventRepository {
  saveRejection(event: RejectedEvent): Promise<void>;
  saveDuplicate(event: DuplicateEvent): Promise<void>;
}
