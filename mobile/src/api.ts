const API_BASE = process.env["EXPO_PUBLIC_API_URL"] ?? "http://localhost:3000";
export const ROOM_HISTORY_LIMIT = 50;

export interface LatestMeasurement {
  temperature: number;
  co2: number;
  observedAt: string;
}

export interface DailyTemperatureAverage {
  date: string;
  averageTemperature: number | null;
}

export function formatMeasurementTimestamp(observedAt: string): string {
  return new Date(observedAt).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface Room {
  roomId: string;
  label: string;
  deviceId: string;
  isOnline: boolean;
  isStale: boolean;
  lastSeenAt: string | null;
  lastTelemetryAt: string | null;
  latestMeasurement: LatestMeasurement | null;
}

export async function fetchRooms(): Promise<Room[]> {
  const res = await fetch(`${API_BASE}/api/rooms`);
  if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
  return res.json() as Promise<Room[]>;
}

export async function fetchRoomHistory(
  roomId: string,
): Promise<LatestMeasurement[]> {
  const res = await fetch(
    `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/history?limit=${ROOM_HISTORY_LIMIT}`,
  );
  if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
  return res.json() as Promise<LatestMeasurement[]>;
}

export async function fetchYesterdayTemperatureAverage(
  roomId: string,
): Promise<DailyTemperatureAverage> {
  const res = await fetch(
    `${API_BASE}/api/rooms/${encodeURIComponent(roomId)}/average/temperature/yesterday`,
  );
  if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
  return res.json() as Promise<DailyTemperatureAverage>;
}
