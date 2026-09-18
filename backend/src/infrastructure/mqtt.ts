import mqtt from 'mqtt';
import type { TelemetryService } from '../application/telemetryService';
import { logger } from './logger';

export function connectMqtt(
  host: string,
  port: number,
  username: string,
  password: string,
  service: TelemetryService,
): void {
  const client = mqtt.connect(`mqtt://${host}:${port}`, {
    username,
    password,
    clientId: 'backend-primary',
    clean: false,
    reconnectPeriod: 3000,
  });

  client.on('connect', () => {
    logger.info('mqtt.connected', { host, port });
    client.subscribe(
      [
        'campus/v1/devices/+/telemetry',
        'campus/v1/devices/+/availability',
        'campus/v1/devices/+/state',
      ],
      { qos: 1 },
      (err: Error | null) => {
        if (err) logger.error('mqtt.subscribe_error', { error: err.message });
      },
    );
  });

  client.on('message', (topic: string, payload: Buffer) => {
    handleMessage(topic, payload.toString(), service).catch((err: unknown) =>
      logger.error('mqtt.handler_error', { topic, error: String(err) }),
    );
  });

  client.on('error', (err: Error) => logger.error('mqtt.error', { error: err.message }));
  client.on('reconnect', () => logger.warn('mqtt.reconnecting', { host, port }));
}

async function handleMessage(
  topic: string,
  payload: string,
  service: TelemetryService,
): Promise<void> {
  if (topic.endsWith('/telemetry')) {
    await service.saveRaw(topic, payload);
  } else if (topic.endsWith('/availability')) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      logger.error('mqtt.parse_error', { topic, reason: 'invalid_json' });
      return;
    }
    const deviceId = topic.split('/')[3];
    const status = data['status'] === 'online' ? 'online' : 'offline';
    await service.processAvailability(deviceId, status, topic);
  }
}
