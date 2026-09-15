import type { Measurement, Device } from './types';

export interface MeasurementRepository {
  save(measurement: Measurement): Promise<void>;
  existsById(messageId: string): Promise<boolean>;
  findLatestByDevice(deviceId: string): Promise<Measurement | null>;
  findHistoryByDevice(deviceId: string, limit: number): Promise<Measurement[]>;
}

export interface DeviceRepository {
  seedIfAbsent(deviceId: string, roomId: string, label: string): Promise<void>;
  updateStatus(deviceId: string, isOnline: boolean, lastSeenAt: string): Promise<void>;
  findAll(): Promise<Device[]>;
  findById(deviceId: string): Promise<Device | null>;
}
