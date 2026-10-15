import { describe, expect, it } from 'vitest';
import { assertLiveScope, assertLiveTarget, liveScope } from '../src/live/scope.js';
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
});
