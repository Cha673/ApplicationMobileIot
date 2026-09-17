type Level = 'info' | 'warn' | 'error';

function log(level: Level, event: string, fields: Record<string, unknown>): void {
  process.stdout.write(
    JSON.stringify({ timestamp: new Date().toISOString(), service: 'backend', level, event, ...fields }) + '\n',
  );
}

export const logger = {
  info: (event: string, fields: Record<string, unknown> = {}) => log('info', event, fields),
  warn: (event: string, fields: Record<string, unknown> = {}) => log('warn', event, fields),
  error: (event: string, fields: Record<string, unknown> = {}) => log('error', event, fields),
};
