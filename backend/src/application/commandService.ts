import { randomUUID } from 'crypto';
import type { CommandRepository } from '../domain/repositories';
import type { Command } from '../domain/types';
import { logger } from '../infrastructure/logger';

export type PublishFn = (topic: string, payload: string) => void;

const DEFAULT_TIMEOUT_MS = 30_000;

export class CommandService {
  private readonly timeoutMs: number;

  constructor(
    private readonly commands: CommandRepository,
    private readonly publish: PublishFn,
    timeoutMs?: number,
  ) {
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async sendCommand(
    deviceId: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<Command> {
    const commandId = randomUUID();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + this.timeoutMs).toISOString();

    const command: Command = {
      commandId,
      deviceId,
      action,
      params,
      status: 'PENDING',
      createdAt: now,
      sentAt: null,
      ackedAt: null,
      expiresAt,
      ackPayload: null,
    };

    await this.commands.save(command);
    logger.info('command.created', { commandId, deviceId, action });

    const mqttPayload = JSON.stringify({
      schema_version: 1,
      command_id: commandId,
      action,
      ...params,
      expires_at: expiresAt,
    });

    this.publish(`campus/v1/devices/${deviceId}/commands`, mqttPayload);

    const sentAt = new Date().toISOString();
    await this.commands.markSent(commandId, sentAt);
    logger.info('command.sent', {
      commandId,
      deviceId,
      action,
      topic: `campus/v1/devices/${deviceId}/commands`,
    });

    return { ...command, status: 'SENT', sentAt };
  }

  async handleAck(topic: string, payload: string): Promise<void> {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      logger.warn('command.ack_parse_error', { topic });
      return;
    }

    const commandId = data['command_id'] as string | undefined;
    if (!commandId) {
      logger.warn('command.ack_missing_command_id', { topic });
      return;
    }

    const command = await this.commands.findById(commandId);
    if (!command) {
      logger.warn('command.ack_unknown', { commandId, topic });
      return;
    }

    logger.info('command.ack_received', {
      commandId,
      deviceId: command.deviceId,
      currentStatus: command.status,
      ackStatus: data['status'],
    });

    if (command.status === 'TIMEOUT') {
      logger.warn('command.ack_after_timeout', {
        commandId,
        deviceId: command.deviceId,
        expiresAt: command.expiresAt,
      });
      return;
    }

    if (command.status === 'ACKNOWLEDGED' || command.status === 'FAILED') {
      logger.warn('command.ack_duplicate', {
        commandId,
        deviceId: command.deviceId,
        currentStatus: command.status,
      });
      return;
    }

    const ackedAt = new Date().toISOString();

    if (data['status'] === 'executed') {
      await this.commands.markAcknowledged(commandId, ackedAt, data);
      logger.info('command.acknowledged', { commandId, deviceId: command.deviceId, ackedAt });
    } else {
      await this.commands.markFailed(commandId, ackedAt, data);
      logger.warn('command.failed', {
        commandId,
        deviceId: command.deviceId,
        reason: data['reason'],
        ackedAt,
      });
    }
  }

  async checkTimeouts(): Promise<void> {
    const now = new Date().toISOString();
    const expired = await this.commands.findExpiredPending(now);
    for (const cmd of expired) {
      await this.commands.markTimeout(cmd.commandId);
      logger.warn('command.timeout', {
        commandId: cmd.commandId,
        deviceId: cmd.deviceId,
        expiresAt: cmd.expiresAt,
      });
    }
  }

  startTimeoutChecker(intervalMs = 10_000): void {
    setInterval(() => {
      this.checkTimeouts().catch((err: unknown) =>
        logger.error('command.timeout_check_failed', { error: String(err) }),
      );
    }, intervalMs);
  }

  async getCommand(commandId: string): Promise<Command | null> {
    return this.commands.findById(commandId);
  }

  async getCommandsByDevice(deviceId: string, limit = 20): Promise<Command[]> {
    return this.commands.findByDevice(deviceId, limit);
  }
}
