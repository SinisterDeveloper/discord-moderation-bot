import { randomUUID } from 'node:crypto';
export const actions = [
  'ban',
  'unban',
  'kick',
  'warn',
  'timeout',
  'untimeout',
  'legacy_unmute',
  'account_age_alert',
  'invite_delete',
  'legacy_mute',
  'legacy_unknown',
] as const;
export type Action = (typeof actions)[number];
export type CaseState =
  'pending' | 'executing' | 'succeeded' | 'failed' | 'unknown' | 'legacy_unverified';
export type Source = 'manual' | 'account_age' | 'invite_filter' | 'legacy' | 'live_test';
export type Preset = 'mentions' | 'words' | 'keywords';
export interface ManagedPreset {
  key: string;
  ruleId: string | null;
  lastApplied: string | null;
  enabled: boolean;
  mentionLimit: number;
  wordCategories: number[];
  keywords: string[];
}
export interface LogChannels {
  modLog?: string | null;
  alertLog?: string | null;
  appealLog?: string | null;
  reportLog?: string | null;
}
export interface GuildSettings {
  guildId: string;
  version: number;
  schemaVersion: 3;
  logChannelId: string | null;
  channels?: LogChannels;
  lastCaseNumber?: number;
  dmEnabled: boolean;
  accountAge: { enabled: boolean; days: number; action: 'alert' | 'kick' };
  invites: { enabled: boolean };
  exemptRoles: string[];
  exemptChannels: string[];
  legacyMuteRoleId: string | null;
  automod: Record<Preset, ManagedPreset>;
}
export function resolveLogChannel(
  settings: GuildSettings,
  kind: keyof LogChannels = 'modLog',
): string | null {
  return settings.channels?.[kind] ?? settings.logChannelId;
}
export function defaultSettings(guildId: string): GuildSettings {
  const preset = (): ManagedPreset => ({
    key: randomUUID().slice(0, 8),
    ruleId: null,
    lastApplied: null,
    enabled: false,
    mentionLimit: 5,
    wordCategories: [3],
    keywords: [],
  });
  return {
    guildId,
    version: 0,
    schemaVersion: 3,
    logChannelId: null,
    dmEnabled: true,
    accountAge: { enabled: false, days: 7, action: 'alert' },
    invites: { enabled: false },
    exemptRoles: [],
    exemptChannels: [],
    legacyMuteRoleId: null,
    automod: { mentions: preset(), words: preset(), keywords: preset() },
  };
}
export interface ActionRequest {
  guildId: string;
  targetId: string;
  actorId: string;
  requestKey: string;
  action: Action;
  source: Source;
  reason: string;
  durationMs?: number;
  channelId?: string;
  messageId?: string;
  joinedAt?: string;
  runId?: string;
}
export interface Delivery {
  status: 'disabled' | 'pending' | 'sending' | 'sent' | 'failed';
  attempts: number;
  nextAttemptAt: Date;
  errorCode: string | null;
  messageId: string | null;
}
export interface CaseChange {
  actorId: string;
  at: Date;
  kind: 'reason' | 'revoke' | 'resolve' | 'appeal';
  value: string;
  previous: string;
}
export interface ModerationCase extends ActionRequest {
  id: string;
  caseNumber?: number;
  state: CaseState;
  createdAt: Date;
  updatedAt: Date;
  errorCode: string | null;
  logChannelId: string | null;
  dm: Delivery;
  staff: Delivery;
  revoked: boolean;
  changes: CaseChange[];
  legacy?: { sourceId: string; rawDate: string; rawType: string; raw: Record<string, unknown> };
}
export function delivery(enabled: boolean, now = new Date()): Delivery {
  return {
    status: enabled ? 'pending' : 'disabled',
    attempts: 0,
    nextAttemptAt: now,
    errorCode: null,
    messageId: null,
  };
}
export class UserError extends Error {
  constructor(
    message: string,
    public code = 'VALIDATION',
  ) {
    super(message);
  }
}
export class ActionFailure extends Error {
  constructor(
    public code: string,
    public certain: boolean,
  ) {
    super('Discord action did not return a confirmed success.');
  }
}
