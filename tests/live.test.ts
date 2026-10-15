import { describe, expect, it } from 'vitest';
import { assertLiveScope, assertLiveTarget, liveScope, liveSettings } from '../src/live/scope.js';
import { LiveModerationService } from '../src/live/adapters.js';
import { fixture, request } from './helpers.js';
describe('live test guard', () => {
  it('accepts only the authorized scope', () => {
    expect(() =>
      assertLiveScope(liveScope.guildId, liveScope.channelId, liveScope.targetId),
    ).not.toThrow();
    expect(() => assertLiveScope('other', liveScope.channelId, liveScope.targetId)).toThrow();
    expect(() => assertLiveScope(liveScope.guildId, 'other', liveScope.targetId)).toThrow();
    expect(() => assertLiveScope(liveScope.guildId, liveScope.channelId, 'other')).toThrow();
  });
  it('refuses owners, bots, and the application itself', () => {
    expect(() => assertLiveTarget('target', 'target', 'app', false)).toThrow();
    expect(() => assertLiveTarget('target', 'owner', 'target', false)).toThrow();
    expect(() => assertLiveTarget('target', 'owner', 'app', true)).toThrow();
    expect(() => assertLiveTarget('target', 'owner', 'app', false)).not.toThrow();
  });
  it('uses new preset identifiers and disables policies without changing the baseline', () => {
    const f = fixture();
    f.settings.accountAge.enabled = true;
    f.settings.automod.keywords.ruleId = '1234567890123456789';
    const baseline = structuredClone(f.settings);
    const active = liveSettings(f.settings);
    expect(active.accountAge.enabled).toBe(false);
    expect(active.automod.keywords.ruleId).toBeNull();
    expect(active.automod.keywords.key).not.toBe(baseline.automod.keywords.key);
    expect(active.version).toBe(baseline.version);
    expect(f.settings).toEqual(baseline);
  });
  it('tags manual and policy cases without changing their authorization source', async () => {
    for (const source of ['manual', 'account_age', 'invite_filter'] as const) {
      const f = fixture();
      await new LiveModerationService(f.store, f.discord, 'test-run').execute(request({ source }));
      expect(f.store.insertCase).toHaveBeenCalledWith(
        expect.objectContaining({ source, runId: 'test-run' }),
        expect.anything(),
      );
    }
  });
});
