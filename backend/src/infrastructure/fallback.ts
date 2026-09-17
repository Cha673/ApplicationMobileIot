import type { MeasurementRepository } from '../domain/repositories';
import type { Measurement } from '../domain/types';
import { logger } from './logger';

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
    } catch (err) {
      logger.warn('fallback.postgres_unavailable', { operation: 'findLatestByDevice', error: String(err) });
      return this.fallback.findLatestByDevice(deviceId);
    }
  }

  async findHistoryByDevice(deviceId: string, limit: number): Promise<Measurement[]> {
    try {
      return await this.primary.findHistoryByDevice(deviceId, limit);
    } catch (err) {
      logger.warn('fallback.postgres_unavailable', { operation: 'findHistoryByDevice', error: String(err) });
      return this.fallback.findHistoryByDevice(deviceId, limit);
    }
  }

  async findAverageTemperatureByDevice(
    deviceId: string,
    from: string,
    to: string,
  ): Promise<number | null> {
    try {
      return await this.primary.findAverageTemperatureByDevice(deviceId, from, to);
    } catch (err) {
      logger.warn('fallback.postgres_unavailable', { operation: 'findAverageTemperature', error: String(err) });
      return this.fallback.findAverageTemperatureByDevice(deviceId, from, to);
    }
  }
}
