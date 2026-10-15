import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  inspectLegacy,
  legacyCase,
  type LegacyRecord,
  type LegacySource,
} from '../src/storage/migration.js';
import { actorId, guildId, targetId } from './helpers.js';
export function legacySource(settings: LegacyRecord[], cases: LegacyRecord[]): LegacySource {
  return {
    settings: async function* () {
      yield* settings;
    },
    cases: async function* () {
      yield* cases;
    },
  };
}
export function legacyFixture(): LegacyRecord {
  return {
    _id: new Types.ObjectId(),
    Guild: guildId,
    User: targetId,
    Moderator: actorId,
    Type: 'Mute',
    Reason: 'Legacy reason',
    Date: '2021-05-19T12:00:00Z',
  };
}
describe('legacy migration preview', () => {
  it('keeps old indefinite mutes distinct from timeouts', () => {
    const record = legacyCase(legacyFixture(), 'old');
    expect(record.action).toBe('legacy_mute');
    expect(record.state).toBe('legacy_unverified');
    expect(record.dm.status).toBe('disabled');
  });
  it('retains raw invalid dates and uses a deterministic fallback', () => {
    const doc: LegacyRecord = { ...legacyFixture(), Date: 'invalid' };
    const record = legacyCase(doc, 'old');
    expect(record.invalidDate).toBe(true);
    expect(record.legacy.rawDate).toBe('invalid');
    expect(record.createdAt).toEqual((doc._id as Types.ObjectId).getTimestamp());
  });
  it('maps enabled minimum-age checks and invite control without mutating source data', async () => {
    const settings = [{ GuildID: guildId, MinimumAge: 7, MuteRoleID: '1108716196024561766' }];
    const before = structuredClone(settings);
    const report = await inspectLegacy(legacySource(settings, [legacyFixture()]), 'old');
    expect(settings).toEqual(before);
    expect(report.errorCount).toBe(0);
    expect(report.settings[0]!.accountAge).toEqual({ enabled: true, days: 7, action: 'kick' });
    expect(report.settings[0]!.invites.enabled).toBe(true);
    expect(report.requiredCapabilities).toEqual({ memberEvents: true, messageFilter: true });
  });
  it('reports invalid settings instead of changing their meaning', async () => {
    const report = await inspectLegacy(
      legacySource([{ GuildID: guildId, MinimumAge: -1 }], []),
      'old',
    );
    expect(report.errorCount).toBe(1);
  });
  it('blocks duplicate settings and invalid required IDs', async () => {
    const report = await inspectLegacy(
      legacySource(
        [{ GuildID: guildId }, { GuildID: guildId }],
        [{ ...legacyFixture(), User: 'invalid' }],
      ),
      'old',
    );
    expect(report.errorCount).toBe(2);
  });
  it('retains unknown action types and missing moderator information', () => {
    const record = legacyCase({ ...legacyFixture(), Type: 'CustomAction', Moderator: null }, 'old');
    expect(record.action).toBe('legacy_unknown');
    expect(record.actorId).toBe('legacy:unknown');
    expect(record.legacy.rawType).toBe('CustomAction');
    expect(legacyCase({ ...legacyFixture(), Type: 'constructor' }, 'old').action).toBe(
      'legacy_unknown',
    );
  });
});
