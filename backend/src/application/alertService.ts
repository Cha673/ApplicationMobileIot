import { randomUUID } from 'crypto';
import type { AlertRepository } from '../domain/repositories';
import type { Alert, Measurement } from '../domain/types';
import { logger } from '../infrastructure/logger';

const CO2_ALERT_THRESHOLD = parseInt(process.env['CO2_ALERT_THRESHOLD'] ?? '1500', 10);
const CO2_ALERT_RESOLUTION = parseInt(process.env['CO2_ALERT_RESOLUTION'] ?? '1200', 10);

export class AlertService {
  constructor(private readonly alerts: AlertRepository) {}

  async evaluate(m: Measurement): Promise<void> {
    const existing = await this.alerts.findActiveByRoomAndRule(m.roomId, 'co2_high');
    const now = new Date().toISOString();

    if (m.co2 > CO2_ALERT_THRESHOLD && !existing) {
      const alert: Alert = {
        id: randomUUID(),
        roomId: m.roomId,
        deviceId: m.deviceId,
        rule: 'co2_high',
        status: 'active',
        triggeredAt: now,
        resolvedAt: null,
        triggeredValue: m.co2,
        resolvedValue: null,
      };
      await this.alerts.open(alert);
      logger.warn('alert.triggered', {
        alertId: alert.id,
        roomId: m.roomId,
        deviceId: m.deviceId,
        rule: 'co2_high',
        value: m.co2,
        threshold: CO2_ALERT_THRESHOLD,
      });
    } else if (m.co2 <= CO2_ALERT_RESOLUTION && existing) {
      await this.alerts.resolve(existing.id, now, m.co2);
      logger.info('alert.resolved', {
        alertId: existing.id,
        roomId: m.roomId,
        deviceId: m.deviceId,
        rule: 'co2_high',
        value: m.co2,
        resolutionThreshold: CO2_ALERT_RESOLUTION,
      });
    }
  }

  async findActive(): Promise<Alert[]> {
    return this.alerts.findActive();
  }
}
