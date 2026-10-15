import { PermissionFlagsBits as P, InteractionContextType } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandDefinitions } from '../src/commands/definitions.js';
import { Sessions } from '../src/commands/sessions.js';
import { checkPermissions, type PermissionContext } from '../src/moderation/permissions.js';
import { auditReason } from '../src/discord/adapter.js';
import { actorId, guildId, request } from './helpers.js';
const context = (): PermissionContext => ({
  ownerId: '1108716196024561766',
  botId: '1108716196024561767',
  actorPermissions: P.ModerateMembers | P.BanMembers | P.KickMembers,
  botPermissions: P.Administrator,
  targetExists: true,
  targetAdministrator: false,
  targetBot: false,
  actorAboveTarget: true,
  botAboveTarget: true,
});
afterEach(() => vi.useRealTimers());
describe('commands and permissions', () => {
  it('registers all commands as server-only commands with valid payloads', () => {
    const names = commandDefinitions.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'ban',
        'kick',
        'timeout',
        'case',
        'config',
        'automod',
        'legacy-unmute',
      ]),
    );
    for (const c of commandDefinitions) expect(c.contexts).toEqual([InteractionContextType.Guild]);
  });
  it('checks actor and bot permissions independently', () => {
    expect(() =>
      checkPermissions(request({ action: 'ban' }), {
        ...context(),
        actorPermissions: P.KickMembers,
      }),
    ).toThrow('permission');
    expect(() =>
      checkPermissions(request({ action: 'timeout' }), {
        ...context(),
        botPermissions: P.KickMembers,
      }),
    ).toThrow('bot');
  });
  it('blocks self, owner, equal roles, and bot targets', () => {
    expect(() => checkPermissions(request({ targetId: actorId }), context())).toThrow('yourself');
    expect(() => checkPermissions(request({ targetId: context().ownerId }), context())).toThrow(
      'owner',
    );
    expect(() => checkPermissions(request(), { ...context(), actorAboveTarget: false })).toThrow(
      'role',
    );
    expect(() =>
      checkPermissions(request({ action: 'ban' }), { ...context(), botAboveTarget: false }),
    ).toThrow('role');
    expect(() => checkPermissions(request({ targetId: context().botId }), context())).toThrow(
      'application bot',
    );
  });
  it('allows the owner to bypass only the actor role comparison', () => {
    expect(() =>
      checkPermissions(request({ action: 'ban' }), {
        ...context(),
        ownerId: actorId,
        actorAboveTarget: false,
      }),
    ).not.toThrow();
    expect(() =>
      checkPermissions(request({ action: 'ban' }), {
        ...context(),
        ownerId: actorId,
        botAboveTarget: false,
      }),
    ).toThrow();
  });
  it('allows off-server bans but not member-only actions', () => {
    expect(() =>
      checkPermissions(request({ action: 'ban' }), { ...context(), targetExists: false }),
    ).not.toThrow();
    expect(() =>
      checkPermissions(request({ action: 'kick' }), { ...context(), targetExists: false }),
    ).toThrow('current');
  });
  it('rejects administrator and bot timeout targets', () => {
    expect(() =>
      checkPermissions(request({ action: 'timeout' }), { ...context(), targetAdministrator: true }),
    ).toThrow('administrators');
    expect(() =>
      checkPermissions(request({ action: 'timeout' }), { ...context(), targetBot: true }),
    ).toThrow('bots');
  });
  it('binds confirmation and page controls to user and server', () => {
    const sessions = new Sessions<string>();
    const key = sessions.create(actorId, guildId, 'action');
    expect(() => sessions.take(key, 'someone-else', guildId)).toThrow('another');
    expect(sessions.take(key, actorId, guildId)).toBe('action');
    expect(() => sessions.take(key, actorId, guildId)).toThrow('expired');
  });
  it('expires controls after one minute', () => {
    vi.useFakeTimers();
    const sessions = new Sessions<string>();
    const key = sessions.create(actorId, guildId, 'action');
    vi.advanceTimersByTime(60_001);
    expect(() => sessions.take(key, actorId, guildId)).toThrow('expired');
  });
  it('bounds encoded audit reasons without losing the case reference', () => {
    const text = auditReason(request({ reason: 'é'.repeat(400) }), 'case-id');
    expect(encodeURIComponent(text).length).toBeLessThanOrEqual(512);
    expect(text).toContain('case-id');
  });
});
