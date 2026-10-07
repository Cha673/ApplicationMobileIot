import express from 'express';
import type { DeviceRepository, MeasurementRepository } from '../domain/repositories';
import type { CommandService } from '../application/commandService';

const HISTORY_LIMIT = 50;
const FRESHNESS_THRESHOLD_MS = Number(process.env['FRESHNESS_THRESHOLD_MS'] ?? 10000);
const SYNC_LAG_THRESHOLD_MS = Number(process.env['SYNC_LAG_THRESHOLD_MS'] ?? 300000);

interface HealthDependencies {
  postgres: () => Promise<void>;
  mongo: () => Promise<void>;
  redis: () => Promise<void>;
  mqtt: () => boolean;
  sync: () => Promise<{ unsyncedCount: number; oldestUnsyncedAt: string | null }>;
}

type DependencyStatus = 'up' | 'down';

async function dependencyCheck(check: () => Promise<void>): Promise<DependencyStatus> {
  try {
    await check();
    return 'up';
  } catch {
    return 'down';
  }
}

function isStale(lastTelemetryAt: string | null): boolean {
  return lastTelemetryAt === null || Date.now() - Date.parse(lastTelemetryAt) > FRESHNESS_THRESHOLD_MS;
}

function parseHistoryLimit(rawLimit: unknown): number {
  const requestedLimit = Number(rawLimit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    return HISTORY_LIMIT;
  }
  return Math.min(requestedLimit, HISTORY_LIMIT);
}

function yesterdayRange(): { date: string; from: string; to: string } {
  const today = new Date();
  const startOfToday = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  ));
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setUTCDate(startOfYesterday.getUTCDate() - 1);
  return {
    date: startOfYesterday.toISOString().slice(0, 10),
    from: startOfYesterday.toISOString(),
    to: startOfToday.toISOString(),
  };
}

async function getHealthStatus(health: HealthDependencies): Promise<Record<string, unknown>> {
  const [postgres, mongo, redis, syncResult] = await Promise.all([
    dependencyCheck(health.postgres),
    dependencyCheck(health.mongo),
    dependencyCheck(health.redis),
    health.sync().then((value) => ({ status: 'up' as const, value })).catch(() => ({
      status: 'down' as const,
      value: { unsyncedCount: 0, oldestUnsyncedAt: null },
    })),
  ]);
  const sync = syncResult.value;
  const mqtt = health.mqtt() ? 'up' : 'down';
  const syncLagMs = sync.oldestUnsyncedAt
    ? Math.max(0, Date.now() - Date.parse(sync.oldestUnsyncedAt))
    : 0;
  const syncStatus = syncResult.status === 'down'
    ? 'unavailable'
    : syncLagMs > SYNC_LAG_THRESHOLD_MS ? 'blocked' : 'healthy';
  const degraded = postgres === 'down' || mqtt === 'down' ||
    syncStatus === 'blocked' || syncStatus === 'unavailable';
  const down = mongo === 'down' || redis === 'down';

  return {
    status: down ? 'down' : degraded ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    dependencies: { postgres, mongo, redis, mqtt },
    sync: {
      status: syncStatus,
      unsyncedCount: sync.unsyncedCount,
      oldestUnsyncedAt: sync.oldestUnsyncedAt,
      lagSeconds: Math.floor(syncLagMs / 1000),
    },
  };
}

export function createHttpServer(
  devices: DeviceRepository,
  measurements: MeasurementRepository,
  commandService: CommandService,
  health: HealthDependencies,

): express.Application {
  const app = express();
  app.use(express.json());

  app.get('/api/health/live', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/health/ready', async (_req, res) => {
    const status = await getHealthStatus(health);
    res.status(status.status === 'down' ? 503 : 200).json(status);
  });

  app.get('/api/health', async (_req, res) => {
    const status = await getHealthStatus(health);
    res.status(status.status === 'down' ? 503 : 200).json(status);
  });

  app.get('/api/rooms', async (_req, res) => {
    const allDevices = await devices.findAll();
    const rooms = await Promise.all(
      allDevices.map(async (device) => ({
        roomId: device.roomId,
        label: device.label || device.roomId,
        deviceId: device.deviceId,
        isOnline: device.isOnline,
        lastSeenAt: device.lastSeenAt,
        lastTelemetryAt: device.lastTelemetryAt,
        isStale: isStale(device.lastTelemetryAt),
        ventilation: device.ventilation,
        latestMeasurement: await measurements.findLatestByDevice(device.deviceId),
      })),
    );
    res.json(rooms);
  });

  app.get('/api/rooms/:roomId', async (req, res) => {
    const allDevices = await devices.findAll();
    const device = allDevices.find((d) => d.roomId === req.params['roomId']);
    if (!device) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }

    res.json({
      roomId: device.roomId,
      label: device.label || device.roomId,
      deviceId: device.deviceId,
      isOnline: device.isOnline,
      lastSeenAt: device.lastSeenAt,
      lastTelemetryAt: device.lastTelemetryAt,
      isStale: isStale(device.lastTelemetryAt),
      ventilation: device.ventilation,
      latestMeasurement: await measurements.findLatestByDevice(device.deviceId),
    });
  });

  app.get('/api/rooms/:roomId/history', async (req, res) => {
    const allDevices = await devices.findAll();
    const device = allDevices.find((d) => d.roomId === req.params['roomId']);
    if (!device) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    const limit = parseHistoryLimit(req.query['limit']);
    res.json(await measurements.findHistoryByDevice(device.deviceId, limit));
  });

  app.get('/api/rooms/:roomId/average/temperature/yesterday', async (req, res) => {
    const allDevices = await devices.findAll();
    const device = allDevices.find((d) => d.roomId === req.params['roomId']);
    if (!device) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    const range = yesterdayRange();
    const averageTemperature = await measurements.findAverageTemperatureByDevice(
      device.deviceId,
      range.from,
      range.to,
    );
    res.json({ date: range.date, averageTemperature });
  });

  app.get('/api/devices', async (_req, res) => {
    res.json(await devices.findAll());
  });

  app.post('/api/rooms/:roomId/commands', async (req, res) => {
    const allDevices = await devices.findAll();
    const device = allDevices.find((d) => d.roomId === req.params['roomId']);
    if (!device) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const { action, ...params } = body;
    if (typeof action !== 'string') {
      res.status(400).json({ error: 'action is required' });
      return;
    }
    const command = await commandService.sendCommand(device.deviceId, action, params);
    res.status(201).json(command);
  });

  app.get('/api/rooms/:roomId/commands', async (req, res) => {
    const allDevices = await devices.findAll();
    const device = allDevices.find((d) => d.roomId === req.params['roomId']);
    if (!device) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    res.json(await commandService.getCommandsByDevice(device.deviceId, 20));
  });

  app.get('/api/commands/:commandId', async (req, res) => {
    const command = await commandService.getCommand(req.params['commandId']!);
    if (!command) {
      res.status(404).json({ error: 'Command not found' });
      return;
    }
    res.json(command);
  });

  return app;
}
