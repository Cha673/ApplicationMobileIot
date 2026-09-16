import { MongoClient, type Db } from 'mongodb';
import type { SyncableMeasurementRepository } from '../domain/repositories';
import type { Measurement } from '../domain/types';

interface MeasurementDoc {
  message_id: string;
  device_id: string;
  room_id: string;
  observed_at: string;
  received_at: string;
  temperature: number;
  co2: number;
  synced: boolean;
}

export function createMongoClient(): MongoClient {
  const uri = process.env['MONGO_URI'] ?? 'mongodb://localhost:27017/campus';
  return new MongoClient(uri);
}

export async function initMongo(client: MongoClient): Promise<Db> {
  const db = client.db();
  const col = db.collection('measurements');
  await col.createIndex({ message_id: 1 }, { unique: true });
  await col.createIndex({ device_id: 1, observed_at: -1 });
  await col.createIndex({ synced: 1 });
  return db;
}

export class MongoMeasurementRepository implements SyncableMeasurementRepository {
  private readonly col;

  constructor(db: Db) {
    this.col = db.collection<MeasurementDoc>('measurements');
  }

  async save(m: Measurement): Promise<void> {
    await this.col.updateOne(
      { message_id: m.messageId },
      { $setOnInsert: toDoc(m) },
      { upsert: true },
    );
  }

  async saveBatch(measurements: Measurement[]): Promise<void> {
    if (measurements.length === 0) return;
    const ops = measurements.map((m) => ({
      updateOne: {
        filter: { message_id: m.messageId },
        update: { $setOnInsert: toDoc(m) },
        upsert: true,
      },
    }));
    await this.col.bulkWrite(ops, { ordered: false });
  }

  async existsById(messageId: string): Promise<boolean> {
    return (await this.col.countDocuments({ message_id: messageId }, { limit: 1 })) > 0;
  }

  async findLatestByDevice(deviceId: string): Promise<Measurement | null> {
    const doc = await this.col.findOne(
      { device_id: deviceId },
      { sort: { observed_at: -1 } },
    );
    return doc ? fromDoc(doc) : null;
  }

  async findHistoryByDevice(deviceId: string, limit: number): Promise<Measurement[]> {
    const docs = await this.col
      .find({ device_id: deviceId })
      .sort({ observed_at: -1 })
      .limit(limit)
      .toArray();
    return docs.map(fromDoc);
  }

  async findAverageTemperatureByDevice(
    deviceId: string,
    from: string,
    to: string,
  ): Promise<number | null> {
    const result = await this.col
      .aggregate<{ average_temperature?: number }>([
        { $match: { device_id: deviceId, observed_at: { $gte: from, $lt: to } } },
        { $group: { _id: null, average_temperature: { $avg: '$temperature' } } },
      ])
      .toArray();
    const average = result[0]?.average_temperature;
    return typeof average === 'number' ? average : null;
  }

  async findUnsynced(limit: number): Promise<Measurement[]> {
    const docs = await this.col
      .find({ synced: false })
      .limit(limit)
      .toArray();
    return docs.map(fromDoc);
  }

  async markSyncedBatch(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await this.col.updateMany(
      { message_id: { $in: messageIds } },
      { $set: { synced: true } },
    );
  }
}

function toDoc(m: Measurement): MeasurementDoc {
  return {
    message_id: m.messageId,
    device_id: m.deviceId,
    room_id: m.roomId,
    observed_at: m.observedAt,
    received_at: m.receivedAt,
    temperature: m.temperature,
    co2: m.co2,
    synced: false,
  };
}

function fromDoc(doc: MeasurementDoc): Measurement {
  return {
    messageId: doc.message_id,
    deviceId: doc.device_id,
    roomId: doc.room_id,
    observedAt: doc.observed_at,
    receivedAt: doc.received_at,
    temperature: doc.temperature,
    co2: doc.co2,
  };
}
