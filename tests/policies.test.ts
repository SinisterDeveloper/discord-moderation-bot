import { EventEmitter } from 'node:events';
import { Events, PermissionFlagsBits as P, type Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
  InviteResolver,
  PolicyService,
  inviteCodes,
  type MessageEvent,
} from '../src/policies/service.js';
import { AutoModManager, type NativePort, type NativeRule } from '../src/policies/automod.js';
import { ModerationService } from '../src/moderation/service.js';
import { attachPolicies } from '../src/policies/events.js';
import { actorId, fixture, guildId, targetId } from './helpers.js';
function policyFixture() {
  const f = fixture();
  f.settings.invites.enabled = true;
  f.settings.accountAge.enabled = true;
  const moderation = new ModerationService(f.store, f.discord);
  const execute = vi.spyOn(moderation, 'execute');
  const lookup = vi.fn(async (code: string) => (code === 'own' ? guildId : '1108716196024561765'));
  const alert = vi.fn(async () => {});
  return {
    ...f,
    execute,
    lookup,
    alert,
    policies: new PolicyService(
      f.store,
      moderation,
      new InviteResolver(lookup),
      () => actorId,
      alert,
    ),
  };
}
const message = (content: string): MessageEvent => ({
  guildId,
  userId: targetId,
  bot: false,
  roles: [],
  permissions: 0n,
  channelId: '1560181480427225159',
  messageId: '1560181480427225160',
  content,
});
describe('bot-run policies', () => {
  it('parses exact hosts, punctuation and multiple distinct links', () => {
    expect(
      inviteCodes(
        'https://discord.gg/own, <https://discord.com/invite/external> discordapp.com/invite/third discord.gg/own',
      ),
    ).toEqual(['own', 'external', 'third']);
    expect(
      inviteCodes(
        'https://evil.discord.gg/code https://discord.gg.evil/code https://notdiscord.gg/code',
      ),
    ).toEqual([]);
  });
  it('preserves own-server invites', async () => {
    const f = policyFixture();
    await f.policies.message(message('discord.gg/own'));
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('deletes once when any invite is external', async () => {
    const f = policyFixture();
    await f.policies.message(message('discord.gg/own discord.gg/external'));
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.execute.mock.calls[0]![0]).toMatchObject({
      action: 'invite_delete',
      source: 'invite_filter',
    });
  });
  it('leaves unresolved invites and rate-limits staff alerts', async () => {
    const f = policyFixture();
    f.lookup.mockRejectedValue(new Error('offline'));
    await f.policies.message(message('discord.gg/own'));
    await f.policies.message(message('discord.gg/own'));
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.alert).toHaveBeenCalledOnce();
  });
  it('shares invite lookups and caches results', async () => {
    const lookup = vi.fn(async () => guildId);
    const resolver = new InviteResolver(lookup);
    await Promise.all([resolver.resolve('own'), resolver.resolve('own')]);
    await resolver.resolve('own');
    expect(lookup).toHaveBeenCalledOnce();
  });
  it('respects bot, administrator, role and channel exemptions', async () => {
    for (const extra of [
      { bot: true },
      { permissions: P.Administrator },
      { roles: ['exempt'] },
      { channelId: 'exempt' },
    ]) {
      const f = policyFixture();
      f.settings.exemptRoles = ['exempt'];
      f.settings.exemptChannels = ['exempt'];
      await f.policies.message({ ...message('discord.gg/external'), ...extra });
      expect(f.execute).not.toHaveBeenCalled();
    }
  });
  it('checks exact account-age boundaries and uses the shared action service', async () => {
    const f = policyFixture();
    const event = {
      guildId,
      userId: targetId,
      bot: false,
      roles: [],
      permissions: 0n,
      createdAt: Date.now() - 7 * 86_400_000,
      joinedAt: new Date().toISOString(),
    };
    await f.policies.joined(event);
    expect(f.execute).not.toHaveBeenCalled();
    await f.policies.joined({ ...event, createdAt: Date.now() });
    expect(f.execute.mock.calls[0]![0]).toMatchObject({
      action: 'account_age_alert',
      requestKey: `age:${targetId}:${event.joinedAt}`,
    });
  });
  it('triggers anti-raid alert or kick when join rate crosses threshold and records AutoMod blocks when auditSync is enabled', async () => {
    const f = policyFixture();
    f.settings.accountAge.enabled = false;
    f.settings.antiRaid = {
      enabled: true,
      joinThreshold: 2,
      windowSeconds: 30,
      action: 'kick',
    };
    const event = {
      guildId,
      userId: targetId,
      bot: false,
      roles: [],
      permissions: 0n,
      createdAt: Date.now() - 30 * 86_400_000,
      joinedAt: new Date().toISOString(),
    };
    await f.policies.joined({ ...event, userId: '100000000000000001' });
    expect(f.execute).not.toHaveBeenCalled();
    await f.policies.joined({ ...event, userId: '100000000000000002' });
    expect(f.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'kick',
        source: 'raid_protection',
        targetId: '100000000000000002',
      }),
    );

    f.settings.auditSync = { enabled: true };
    await f.policies.automodExecution({
      guildId,
      userId: targetId,
      ruleId: 'rule-99',
      actionType: 1,
      channelId: '1560181480427225159',
      messageId: '1560181480427225160',
      matchedKeyword: 'scam-link',
    });
    expect(f.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'automod_block',
        source: 'audit_sync',
        targetId,
      }),
    );
  });
  it('stops without actions when storage is unavailable', async () => {
    const f = policyFixture();
    vi.mocked(f.store.available).mockReturnValue(false);
    await f.policies.message(message('discord.gg/external'));
    expect(f.lookup).not.toHaveBeenCalled();
  });
  it('fetches an uncached edit before applying invite filtering', async () => {
    const f = fixture();
    f.settings.invites.enabled = true;
    const client = Object.assign(new EventEmitter(), {
      user: { id: actorId },
      fetchInvite: vi.fn(async () => ({ guild: { id: '1108716196024561765' } })),
    });
    attachPolicies(
      client as unknown as Client,
      f.store,
      new ModerationService(f.store, f.discord),
      { memberEvents: false, messageFilter: true },
      { guildId, targetId, channelId: '1560181480427225159' },
    );
    const full = {
      ...message('discord.gg/external'),
      id: '1560181480427225160',
      author: { id: targetId, bot: false },
      guild: {
        id: guildId,
        members: {
          fetch: vi.fn(async () => ({
            permissions: { has: () => false, bitfield: 0n },
            roles: { cache: new Map() },
          })),
        },
      },
    };
    const fetch = vi.fn(async () => full);
    client.emit(Events.MessageUpdate, null, {
      guildId,
      channelId: full.channelId,
      partial: true,
      fetch,
    });
    await vi.waitFor(() => expect(f.discord.perform).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledOnce();
    expect(f.store.insertCase).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'invite_delete', messageId: full.id }),
      expect.anything(),
    );
  });
});
function nativeFixture() {
  const f = fixture();
  const rules: NativeRule[] = [];
  vi.mocked(f.store.saveSettings).mockImplementation(async (settings) => {
    settings.version++;
    Object.assign(f.settings, structuredClone(settings));
    return settings;
  });
  const port: NativePort = {
    botId: () => actorId,
    list: vi.fn(async () => structuredClone(rules)),
    checkLog: vi.fn(async () => {}),
    create: vi.fn(async (_guild, spec) => {
      const rule = { ...structuredClone(spec), id: `native-${rules.length}`, creator_id: actorId };
      rules.push(rule);
      return structuredClone(rule);
    }),
    edit: vi.fn(async (_guild, id, spec) => {
      const rule = rules.find((r) => r.id === id)!;
      Object.assign(rule, structuredClone(spec));
      return structuredClone(rule);
    }),
  };
  return { ...f, rules, port, manager: new AutoModManager(f.store, port) };
}
describe('owned AutoMod presets', () => {
  it('does not create a second rule after the rule ID could not be saved', async () => {
    const f = nativeFixture();
    const preview = await f.manager.preview(guildId, 'mentions', true);
    vi.mocked(f.store.saveSettings).mockRejectedValueOnce(new Error('write failed'));
    await expect(f.manager.apply(guildId, 'mentions', true, preview.fingerprint)).rejects.toThrow(
      'write failed',
    );
    expect(f.rules).toHaveLength(1);
    const next = await f.manager.preview(guildId, 'mentions', true);
    await f.manager.apply(guildId, 'mentions', true, next.fingerprint);
    expect(f.port.create).toHaveBeenCalledOnce();
    expect(f.port.edit).toHaveBeenCalledOnce();
  });
  it('requires configuration and saves drafts without changing Discord', async () => {
    const f = nativeFixture();
    await expect(f.manager.preview(guildId, 'keywords', true)).rejects.toThrow('keyword');
    await f.manager.configure(guildId, 'keywords', {
      keywords: 'one\ntwo\none',
      categories: null,
      limit: null,
    });
    expect(f.settings.automod.keywords.keywords).toEqual(['one', 'two']);
    expect(f.port.create).not.toHaveBeenCalled();
  });
  it('enforces category, keyword and mention limits', async () => {
    const f = nativeFixture();
    await expect(
      f.manager.configure(guildId, 'mentions', { limit: 51, categories: null, keywords: null }),
    ).rejects.toThrow('1 to 50');
    await expect(
      f.manager.configure(guildId, 'words', { limit: null, categories: 'unknown', keywords: null }),
    ).rejects.toThrow('categories');
    await expect(
      f.manager.configure(guildId, 'keywords', {
        limit: null,
        categories: null,
        keywords: 'a'.repeat(61),
      }),
    ).rejects.toThrow('60');
  });
  it('creates only an owned rule after a valid preview', async () => {
    const f = nativeFixture();
    const p = await f.manager.preview(guildId, 'mentions', true);
    await f.manager.apply(guildId, 'mentions', true, p.fingerprint);
    expect(f.rules).toHaveLength(1);
    expect(f.rules[0]!.trigger_type).toBe(5);
    expect(f.settings.automod.mentions.ruleId).toBe(f.rules[0]!.id);
    expect(await f.manager.status(guildId)).not.toContain('external changes');
  });
  it('refuses occupied slots without editing foreign rules', async () => {
    const f = nativeFixture();
    const p = await f.manager.preview(guildId, 'mentions', true);
    await f.manager.apply(guildId, 'mentions', true, p.fingerprint);
    f.rules[0]!.creator_id = 'other-bot';
    f.settings.automod.mentions.ruleId = null;
    await expect(f.manager.preview(guildId, 'mentions', true)).rejects.toThrow('free slot');
    expect(f.port.edit).not.toHaveBeenCalled();
  });
  it('rejects settings or rule changes after confirmation preview', async () => {
    const f = nativeFixture();
    const p = await f.manager.preview(guildId, 'mentions', true);
    f.settings.version++;
    await expect(f.manager.apply(guildId, 'mentions', true, p.fingerprint)).rejects.toThrow(
      'changed',
    );
    expect(f.port.create).not.toHaveBeenCalled();
  });
  it('recovers a lost ID and reports external changes', async () => {
    const f = nativeFixture();
    let p = await f.manager.preview(guildId, 'mentions', true);
    await f.manager.apply(guildId, 'mentions', true, p.fingerprint);
    f.settings.automod.mentions.ruleId = null;
    f.rules[0]!.enabled = false;
    expect(await f.manager.status(guildId)).toContain('external changes');
    p = await f.manager.preview(guildId, 'mentions', true);
    await f.manager.apply(guildId, 'mentions', true, p.fingerprint);
    expect(f.port.create).toHaveBeenCalledOnce();
    expect(f.port.edit).toHaveBeenCalledOnce();
  });
  it('does not disable a rule owned by another bot', async () => {
    const f = nativeFixture();
    const p = await f.manager.preview(guildId, 'mentions', true);
    await f.manager.apply(guildId, 'mentions', true, p.fingerprint);
    f.rules[0]!.creator_id = 'foreign';
    await expect(f.manager.preview(guildId, 'mentions', false)).rejects.toThrow('not owned');
    expect(f.port.edit).not.toHaveBeenCalled();
  });
  it('supports regex patterns, allow-list, mention raid protection, and AutoMod timeout actions', async () => {
    const f = nativeFixture();
    await f.manager.configure(guildId, 'keywords', {
      limit: null,
      categories: null,
      keywords: null,
      regex: 'discord\\.gg/[a-z0-9]+',
      allowList: 'discord.gg/official',
      timeoutSeconds: 300,
    });
    expect(f.settings.automod.keywords.regexPatterns).toEqual(['discord\\.gg/[a-z0-9]+']);
    expect(f.settings.automod.keywords.allowList).toEqual(['discord.gg/official']);
    expect(f.settings.automod.keywords.timeoutSeconds).toBe(300);
    const p = await f.manager.preview(guildId, 'keywords', true);
    await f.manager.apply(guildId, 'keywords', true, p.fingerprint);
    expect(f.rules[0]!.trigger_metadata).toMatchObject({
      regex_patterns: ['discord\\.gg/[a-z0-9]+'],
      allow_list: ['discord.gg/official'],
    });
    expect(f.rules[0]!.actions).toEqual(
      expect.arrayContaining([{ type: 3, metadata: { duration_seconds: 300 } }]),
    );
  });
});
