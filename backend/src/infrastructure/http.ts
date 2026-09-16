import express from 'express';
import type { DeviceRepository, MeasurementRepository } from '../domain/repositories';

const HISTORY_LIMIT = 50;

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

export function createHttpServer(
  devices: DeviceRepository,
  measurements: MeasurementRepository,
): express.Application {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

  return app;
}
