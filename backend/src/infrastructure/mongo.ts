import { MongoClient, ObjectId, type Db, type WithId } from 'mongodb';
import type { SyncableMeasurementRepository, RawEventRepository } from '../domain/repositories';
import type { Measurement, RawEvent } from '../domain/types';

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

  const measurements = db.collection('measurements');
  await measurements.createIndex({ message_id: 1 }, { unique: true });
  await measurements.createIndex({ device_id: 1, observed_at: -1, received_at: -1, message_id: -1 });
  await measurements.createIndex({ synced: 1 });

  const rawEvents = db.collection('raw_events');
  await rawEvents.createIndex({ status: 1 });
  await rawEvents.createIndex({ received_at: -1 });

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
      { sort: { observed_at: -1, received_at: -1, message_id: -1 } },
    );
    return doc ? fromDoc(doc) : null;
  }

  async findHistoryByDevice(deviceId: string, limit: number): Promise<Measurement[]> {
    const docs = await this.col
      .find({ device_id: deviceId })
      .sort({ observed_at: -1, received_at: -1, message_id: -1 })
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

interface RawEventDoc {
  topic: string;
  payload: string;
  received_at: string;
  status: 'pending' | 'accepted' | 'rejected' | 'duplicate';
  error?: string;
  processed_at?: string;
}

export class MongoRawEventRepository implements RawEventRepository {
  private readonly col;

  constructor(db: Db) {
    this.col = db.collection<RawEventDoc>('raw_events');
  }

  async save(topic: string, payload: string, receivedAt: string): Promise<string> {
    const result = await this.col.insertOne({ topic, payload, received_at: receivedAt, status: 'pending' });
    return result.insertedId.toString();
  }

  async findPending(limit: number): Promise<RawEvent[]> {
    const docs = await this.col.find({ status: 'pending' }).limit(limit).toArray();
    return docs.map(fromRawDoc);
  }

  async markAccepted(id: string, processedAt: string): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'accepted', processed_at: processedAt } },
    );
  }

  async markRejected(id: string, error: string, processedAt: string): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'rejected', error, processed_at: processedAt } },
    );
  }

  async markDuplicate(id: string, processedAt: string): Promise<void> {
    await this.col.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'duplicate', processed_at: processedAt } },
    );
  }
}

function fromRawDoc(doc: WithId<RawEventDoc>): RawEvent {
  return {
    id: doc._id.toString(),
    topic: doc.topic,
    payload: doc.payload,
    receivedAt: doc.received_at,
    status: doc.status,
    error: doc.error,
    processedAt: doc.processed_at,
  };
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
