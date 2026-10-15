import { describe, expect, it } from 'vitest';
import { parseDuration, readEnvironment } from '../src/config.js';
describe('configuration', () => {
  it('rejects secrets without exposing input values', () => {
    expect(() => readEnvironment({ DISCORD_TOKEN: 'private-value' })).toThrow(
      'Invalid configuration',
    );
    expect(() => readEnvironment({ DISCORD_TOKEN: 'private-value' })).not.toThrow('private-value');
  });
  it('uses explicit capability flags', () => {
    const config = readEnvironment({
      DISCORD_TOKEN: 'x'.repeat(30),
      APPLICATION_ID: '1108716196024561764',
      MONGODB_URI: 'mongodb://localhost/test',
    });
    expect(config.ENABLE_MEMBER_EVENTS).toBe(false);
    expect(config.ENABLE_MESSAGE_FILTER).toBe(false);
  });
  it('accepts bounded durations', () => {
    expect(parseDuration('28d')).toBe(2_419_200_000);
    expect(parseDuration('30m')).toBe(1_800_000);
    for (const value of ['0s', '-1d', '1.5h', '29d', '1h30m', 'Infinityd'])
      expect(() => parseDuration(value)).toThrow();
  });
});
