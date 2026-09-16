import type { MeasurementRepository } from '../domain/repositories';
import type { Measurement } from '../domain/types';

export class FallbackMeasurementRepository implements MeasurementRepository {
  constructor(
    private readonly primary: MeasurementRepository,
    private readonly fallback: MeasurementRepository,
  ) {}

  async save(m: Measurement): Promise<void> {
    await this.primary.save(m);
  }

  async saveBatch(measurements: Measurement[]): Promise<void> {
    await this.primary.saveBatch(measurements);
  }

  async existsById(messageId: string): Promise<boolean> {
    try {
      return await this.primary.existsById(messageId);
    } catch {
      return this.fallback.existsById(messageId);
    }
  }

  async findLatestByDevice(deviceId: string): Promise<Measurement | null> {
    try {
      return await this.primary.findLatestByDevice(deviceId);
    } catch {
      console.warn('[fallback] postgres unavailable, reading from mongo');
      return this.fallback.findLatestByDevice(deviceId);
    }
  }

  async findHistoryByDevice(deviceId: string, limit: number): Promise<Measurement[]> {
    try {
      return await this.primary.findHistoryByDevice(deviceId, limit);
    } catch {
      console.warn('[fallback] postgres unavailable, reading from mongo');
      return this.fallback.findHistoryByDevice(deviceId, limit);
    }
  }
}
