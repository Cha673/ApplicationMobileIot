import express from 'express';
import type { DeviceRepository, MeasurementRepository } from '../domain/repositories';

const HISTORY_LIMIT = 50;

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
    res.json(await measurements.findHistoryByDevice(device.deviceId, HISTORY_LIMIT));
  });

  app.get('/api/devices', async (_req, res) => {
    res.json(await devices.findAll());
  });

  return app;
}
