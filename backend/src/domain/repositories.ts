import type { Measurement, Device, RejectedEvent, DuplicateEvent, RawEvent, Command, Alert } from './types';

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
  updateStatus(
    deviceId: string,
    isOnline: boolean,
    lastSeenAt: string,
  ): Promise<void>;
  updateTelemetrySeen(deviceId: string, receivedAt: string): Promise<void>;
  updateVentilation(deviceId: string, ventilation: boolean): Promise<void>;
  findAll(): Promise<Device[]>;
  findById(deviceId: string): Promise<Device | null>;
}

export interface EventRepository {
  saveRejection(event: RejectedEvent): Promise<void>;
  saveDuplicate(event: DuplicateEvent): Promise<void>;
}

export interface RawEventRepository {
  save(topic: string, payload: string, receivedAt: string): Promise<string>;
  findPending(limit: number): Promise<RawEvent[]>;
  markAccepted(id: string, processedAt: string): Promise<void>;
  markRejected(id: string, error: string, processedAt: string): Promise<void>;
  markDuplicate(id: string, processedAt: string): Promise<void>;
}

export interface CommandRepository {
  save(command: Command): Promise<void>;
  findById(commandId: string): Promise<Command | null>;
  markSent(commandId: string, sentAt: string): Promise<void>;
  markAcknowledged(commandId: string, ackedAt: string, ackPayload: Record<string, unknown>): Promise<void>;
  markFailed(commandId: string, ackedAt: string, ackPayload: Record<string, unknown>): Promise<void>;
  markTimeout(commandId: string): Promise<void>;
  findExpiredPending(now: string): Promise<Command[]>;
  findByDevice(deviceId: string, limit: number): Promise<Command[]>;
}

export interface AlertRepository {
  open(alert: Alert): Promise<void>;
  resolve(id: string, resolvedAt: string, resolvedValue: number): Promise<void>;
  findActiveByRoomAndRule(roomId: string, rule: string): Promise<Alert | null>;
  findActive(): Promise<Alert[]>;
}
