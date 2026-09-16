const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export interface LatestMeasurement {
  temperature: number;
  co2: number;
  observedAt: string;
}

export interface Room {
  roomId: string;
  label: string;
  deviceId: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  latestMeasurement: LatestMeasurement | null;
}

export async function fetchRooms(): Promise<Room[]> {
  const res = await fetch(`${API_BASE}/api/rooms`);
  if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
  return res.json() as Promise<Room[]>;
}

export async function fetchRoomHistory(roomId: string): Promise<LatestMeasurement[]> {
  const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/history`);
  if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
  return res.json() as Promise<LatestMeasurement[]>;
}
