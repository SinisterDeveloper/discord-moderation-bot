import { Types } from 'mongoose';
import { snowflake } from '../config.js';
import {
  defaultSettings,
  delivery,
  type Action,
  type ActionRequest,
  type GuildSettings,
} from '../domain.js';
import type { MongoStore } from './store.js';
export type LegacyRecord = Record<string, unknown>;
export interface LegacySource {
  settings(): AsyncIterable<LegacyRecord>;
  cases(): AsyncIterable<LegacyRecord>;
}
export interface MigrationReport {
  settings: GuildSettings[];
  caseCount: number;
  errors: string[];
  errorCount: number;
  warnings: string[];
  warningCount: number;
  requiredCapabilities: { memberEvents: boolean; messageFilter: boolean };
}
const validId = (value: unknown): value is string => snowflake.safeParse(value).success;
export function legacyCase(doc: LegacyRecord, sourceName: string) {
  if (!validId(doc.Guild) || !validId(doc.User))
    throw new Error('A legacy case has an invalid server or user ID.');
  const sourceId = String(doc._id);
  const rawDate = String(doc.Date ?? '');
  const parsed = new Date(rawDate);
  const invalidDate = !Number.isFinite(parsed.getTime());
  const createdAt = !invalidDate
    ? parsed
    : /^[a-f0-9]{24}$/i.test(sourceId)
      ? new Types.ObjectId(sourceId).getTimestamp()
      : new Date(0);
  const mapped: Record<string, Action> = {
    Ban: 'ban',
    Unban: 'unban',
    Kick: 'kick',
    Warn: 'warn',
    Mute: 'legacy_mute',
    Unmute: 'legacy_unmute',
  };
  const request: ActionRequest = {
    guildId: doc.Guild,
    targetId: doc.User,
    actorId: validId(doc.Moderator) ? doc.Moderator : 'legacy:unknown',
    requestKey: `legacy:${sourceName}:modlogs:${sourceId}`,
    source: 'legacy',
    action: Object.hasOwn(mapped, String(doc.Type)) ? mapped[String(doc.Type)]! : 'legacy_unknown',
    reason:
      String(doc.Reason ?? '')
        .trim()
        .slice(0, 400) || 'No legacy reason recorded.',
  };
  return {
    ...request,
    createdAt,
    updatedAt: createdAt,
    state: 'legacy_unverified' as const,
    errorCode: null,
    logChannelId: null,
    dm: delivery(false, createdAt),
    staff: delivery(false, createdAt),
    revoked: false,
    changes: [],
    legacy: { sourceId, rawDate, rawType: String(doc.Type ?? ''), raw: doc },
    invalidDate,
  };
}
export async function inspectLegacy(
  source: LegacySource,
  sourceName: string,
): Promise<MigrationReport> {
  const settings = new Map<string, GuildSettings>();
  const report: MigrationReport = {
    settings: [],
    caseCount: 0,
    errors: [],
    errorCount: 0,
    warnings: [],
    warningCount: 0,
    requiredCapabilities: { memberEvents: false, messageFilter: false },
  };
  const error = (text: string) => {
    report.errorCount++;
    if (report.errors.length < 100) report.errors.push(text);
  };
  const warning = (text: string) => {
    report.warningCount++;
    if (report.warnings.length < 100) report.warnings.push(text);
  };
  for await (const doc of source.settings()) {
    if (!validId(doc.GuildID)) {
      error('A settings record has an invalid server ID.');
      continue;
    }
    if (settings.has(doc.GuildID)) {
      error(`Duplicate legacy settings for server ${doc.GuildID}.`);
      continue;
    }
    const value = defaultSettings(doc.GuildID);
    value.invites.enabled = true;
    const days = Number(doc.MinimumAge ?? 0);
    if (!Number.isInteger(days) || days < 0 || days > 3650)
      error(`Invalid minimum account age for server ${doc.GuildID}.`);
    else if (days > 0) value.accountAge = { enabled: true, days, action: 'kick' };
    if (doc.MuteRoleID !== undefined && doc.MuteRoleID !== null) {
      if (!validId(doc.MuteRoleID)) error(`Invalid legacy mute role for server ${doc.GuildID}.`);
      else value.legacyMuteRoleId = doc.MuteRoleID;
    }
    settings.set(doc.GuildID, value);
  }
  for await (const doc of source.cases()) {
    try {
      const value = legacyCase(doc, sourceName);
      report.caseCount++;
      if (value.invalidDate)
        warning(
          `Case ${value.legacy.sourceId} has an invalid date; its raw date will be retained.`,
        );
      if (value.actorId === 'legacy:unknown')
        warning(`Case ${value.legacy.sourceId} has no valid moderator ID.`);
      if (!settings.has(value.guildId)) {
        const config = defaultSettings(value.guildId);
        config.invites.enabled = true;
        settings.set(value.guildId, config);
      }
    } catch {
      error(`Invalid required IDs in legacy case ${String(doc._id)}.`);
    }
  }
  report.settings = [...settings.values()];
  report.requiredCapabilities = {
    memberEvents: report.settings.some((s) => s.accountAge.enabled),
    messageFilter: report.settings.length > 0,
  };
  return report;
}
export async function importLegacy(
  source: LegacySource,
  sourceName: string,
  target: MongoStore,
  report: MigrationReport,
) {
  if (report.errorCount) throw new Error('Resolve preview errors before importing.');
  let settingsInserted = 0;
  let casesInserted = 0;
  for (const settings of report.settings) {
    const result = await target.settings.updateOne(
      { guildId: settings.guildId },
      { $setOnInsert: settings },
      { upsert: true },
    );
    settingsInserted += result.upsertedCount;
  }
  for await (const doc of source.cases()) {
    const { invalidDate, ...value } = legacyCase(doc, sourceName);
    void invalidDate;
    const result = await target.cases.updateOne(
      { guildId: value.guildId, requestKey: value.requestKey },
      { $setOnInsert: value },
      { upsert: true },
    );
    casesInserted += result.upsertedCount;
  }
  return { settingsInserted, casesInserted };
}
