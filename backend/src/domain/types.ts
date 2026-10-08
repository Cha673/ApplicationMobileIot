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
  lastTelemetryAt: string | null;
  ventilation: boolean;
}

export type CommandStatus = 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'FAILED' | 'TIMEOUT';

export interface Command {
  commandId: string;
  deviceId: string;
  action: string;
  params: Record<string, unknown>;
  status: CommandStatus;
  createdAt: string;
  sentAt: string | null;
  ackedAt: string | null;
  expiresAt: string;
  ackPayload: Record<string, unknown> | null;
}

export interface RejectedEvent {
  topic: string;
  deviceId?: string;
  eventId?: string;
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

export interface RawEvent {
  id: string;
  topic: string;
  payload: string;
  receivedAt: string;
  status: 'pending' | 'accepted' | 'rejected' | 'duplicate';
  error?: string;
  processedAt?: string;
}

export interface Alert {
  id: string;
  roomId: string;
  deviceId: string;
  rule: string;
  status: 'active' | 'resolved';
  triggeredAt: string;
  resolvedAt: string | null;
  triggeredValue: number;
  resolvedValue: number | null;
}
