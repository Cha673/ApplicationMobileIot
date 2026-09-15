import mqtt from 'mqtt';
import type { TelemetryService } from '../application/telemetryService';

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
    clientId: `backend-${Date.now()}`,
    clean: true,
    reconnectPeriod: 3000,
  });

  client.on('connect', () => {
    console.log(`[mqtt] connected to ${host}:${port}`);
    client.subscribe(
      [
        'campus/v1/devices/+/telemetry',
        'campus/v1/devices/+/availability',
        'campus/v1/devices/+/state',
      ],
      { qos: 1 },
      (err: Error | null) => {
        if (err) console.error('[mqtt] subscribe error:', err);
      },
    );
  });

  client.on('message', (topic: string, payload: Buffer) => {
    handleMessage(topic, payload.toString(), service).catch((err: unknown) =>
      console.error(`[mqtt] handler error on ${topic}:`, err),
    );
  });

  client.on('error', (err: Error) => console.error('[mqtt] error:', err.message));
  client.on('reconnect', () => console.log('[mqtt] reconnecting…'));
}

async function handleMessage(
  topic: string,
  payload: string,
  service: TelemetryService,
): Promise<void> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    console.error(`[mqtt] parse error on ${topic}`);
    return;
  }

  if (topic.endsWith('/telemetry')) {
    await service.processTelemetry(data);
  } else if (topic.endsWith('/availability')) {
    const deviceId = topic.split('/')[3];
    const status = data['status'] === 'online' ? 'online' : 'offline';
    await service.processAvailability(deviceId, status);
  }
}
