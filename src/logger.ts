import pino from 'pino';
export function createLogger(level = 'info') {
  return pino({
    level,
    redact: {
      paths: [
        'token',
        'DISCORD_TOKEN',
        'MONGODB_URI',
        'authorization',
        'headers.authorization',
        '*.token',
        '*.interactionToken',
        '*.password',
      ],
      censor: '[REDACTED]',
    },
  });
}
export const logger = createLogger(process.env.LOG_LEVEL ?? 'info');
export function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) return String(error.code);
  return 'INTERNAL_ERROR';
}
