type Level = 'info' | 'warn' | 'error';

function log(level: Level, eventType: string, fields: Record<string, unknown>): void {
  process.stdout.write(
    JSON.stringify({ timestamp: new Date().toISOString(), service: 'backend', level, eventType, ...fields }) + '\n',
  );
}

export const logger = {
  info: (eventType: string, fields: Record<string, unknown> = {}) => log('info', eventType, fields),
  warn: (eventType: string, fields: Record<string, unknown> = {}) => log('warn', eventType, fields),
  error: (eventType: string, fields: Record<string, unknown> = {}) => log('error', eventType, fields),
};
