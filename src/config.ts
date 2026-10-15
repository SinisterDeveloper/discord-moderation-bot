import { z } from 'zod';
import { UserError } from './domain.js';
export const snowflake = z.string().regex(/^\d{17,20}$/, 'Use a valid Discord ID.');
export const reasonSchema = z.string().trim().min(1).max(400);
export function parseReason(value: string): string {
  const result = reasonSchema.safeParse(value);
  if (!result.success) throw new UserError('Use a reason from 1 to 400 characters.');
  return result.data;
}
const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');
export const capabilitiesSchema = z.object({
  ENABLE_MEMBER_EVENTS: flag,
  ENABLE_MESSAGE_FILTER: flag,
});
export const environmentSchema = capabilitiesSchema.extend({
  DISCORD_TOKEN: z.string().trim().min(20),
  APPLICATION_ID: snowflake,
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  MONGODB_DATABASE: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .max(38)
    .default('moderation_bot_v3'),
  HEALTH_HOST: z.string().default('127.0.0.1'),
  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});
export type Environment = z.infer<typeof environmentSchema>;
export type Capabilities = { memberEvents: boolean; messageFilter: boolean };
export function readEnvironment(env: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}.`,
    );
  return result.data;
}
export function parseDuration(value: string): number {
  const match = /^([1-9]\d*)(s|m|h|d)$/.exec(value);
  if (!match) throw new UserError('Use a positive duration such as 30m, 12h, or 7d.');
  const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const duration = Number(match[1]) * units[match[2]!]!;
  if (!Number.isSafeInteger(duration) || duration > 28 * 86_400_000)
    throw new UserError('Timeouts must be between 1 second and 28 days.');
  return duration;
}
