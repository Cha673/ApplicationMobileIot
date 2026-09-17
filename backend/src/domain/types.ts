export interface Measurement {
  messageId: string;
  deviceId: string;
  roomId: string;
  observedAt: string;
  receivedAt: string;
  temperature: number;
  co2: number;
}

export interface Device {
  deviceId: string;
  roomId: string;
  label: string;
  isOnline: boolean;
  lastSeenAt: string | null;
}

export interface RejectedEvent {
  topic: string;
  deviceId?: string;
  messageId?: string;
  reason: string;
  field?: string;
  value?: number;
  min?: number;
  max?: number;
}

export interface DuplicateEvent {
  topic: string;
  deviceId: string;
  messageId: string;
}
