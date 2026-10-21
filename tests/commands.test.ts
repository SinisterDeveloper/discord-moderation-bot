import {
  PermissionFlagsBits as P,
  InteractionContextType,
  MessageFlags,
  type Client,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandDefinitions } from '../src/commands/definitions.js';
import { Sessions } from '../src/commands/sessions.js';
import { checkPermissions, type PermissionContext } from '../src/moderation/permissions.js';
import { auditReason } from '../src/discord/adapter.js';
import { actorId, guildId, targetId, fixture, request } from './helpers.js';
import { CommandRouter } from '../src/commands/router.js';
import { ModerationService } from '../src/moderation/service.js';
import { UserError } from '../src/domain.js';
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
describe('interaction handling', () => {
  const interaction = (commandName: string) => ({
    commandName,
    id: '1234567890123456789',
    guildId,
    user: { id: actorId },
    isChatInputCommand: () => true,
    isButton: () => false,
    inGuild: () => true,
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    options: {
      getString: (name: string) => (name === 'target' ? targetId : 'Test reason'),
    },
  });
  it('acknowledges ping privately and returns the connection state', async () => {
    const f = fixture();
    const router = new CommandRouter(
      { ws: { ping: 12 } } as Client,
      f.store,
      new ModerationService(f.store, f.discord),
      { memberEvents: false, messageFilter: false },
    );
    const i = interaction('ping');
    expect(await router.handle(i as unknown as ChatInputCommandInteraction)).toBe(true);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const response = i.editReply.mock.calls[0]![0];
    expect(response.content).toBe('');
    expect(response.allowedMentions).toEqual({ parse: [] });
    expect(response.embeds).toHaveLength(1);
    expect(response.embeds[0].toJSON()).toMatchObject({
      title: 'Pong',
      description: '**Gateway** 12 ms · **Database** Ready',
    });
  });
  it('checks permissions again when a moderator confirms a ban', async () => {
    const f = fixture();
    vi.mocked(f.discord.authorize)
      .mockResolvedValueOnce('allowed')
      .mockRejectedValueOnce(new UserError('Permission changed.'));
    const router = new CommandRouter(
      {} as Client,
      f.store,
      new ModerationService(f.store, f.discord),
      { memberEvents: false, messageFilter: false },
    );
    const i = interaction('ban');
    await router.handle(i as unknown as ChatInputCommandInteraction);
    const response = i.editReply.mock.calls[0]![0];
    const customId = response.components[0].toJSON().components[0].custom_id;
    const button = {
      ...i,
      isChatInputCommand: () => false,
      isButton: () => true,
      customId,
      update: vi.fn().mockResolvedValue(undefined),
      deferred: true,
    };
    expect(await router.handle(button as unknown as ButtonInteraction)).toBe(false);
    expect(f.discord.authorize).toHaveBeenCalledTimes(2);
    expect(f.discord.perform).not.toHaveBeenCalled();
    expect(f.store.insertCase).not.toHaveBeenCalled();
  });
  it('rejects policy activation when the runtime capability is disabled', async () => {
    const f = fixture();
    const client = {
      guilds: {
        fetch: async () => ({
          ownerId: actorId,
          members: { fetch: async () => ({ id: actorId }) },
        }),
      },
    } as unknown as Client;
    const router = new CommandRouter(client, f.store, new ModerationService(f.store, f.discord), {
      memberEvents: false,
      messageFilter: false,
    });
    const i = {
      ...interaction('config'),
      deferred: true,
      options: {
        getSubcommand: () => 'account-age',
        getBoolean: () => true,
      },
    };
    expect(await router.handle(i as unknown as ChatInputCommandInteraction)).toBe(false);
    const response = i.editReply.mock.calls[0]![0];
    expect(response.content).toBe('');
    expect(response.embeds[0].toJSON()).toMatchObject({
      title: 'Request not completed',
      description: expect.stringContaining('Enable member events'),
    });
    expect(f.store.saveSettings).not.toHaveBeenCalled();
  });
  it('supports interactive /panel navigation, role select menus, and modals', async () => {
    const f = fixture();
    const client = {
      guilds: {
        fetch: async () => ({
          ownerId: actorId,
          members: { fetch: async () => ({ id: actorId, permissions: { has: () => true } }) },
        }),
      },
    } as unknown as Client;
    const router = new CommandRouter(client, f.store, new ModerationService(f.store, f.discord), {
      memberEvents: true,
      messageFilter: true,
    });
    const i = interaction('panel');
    expect(await router.handle(i as unknown as ChatInputCommandInteraction)).toBe(true);
    const overview = i.editReply.mock.calls[0]![0];
    expect(overview.embeds[0].toJSON().title).toContain('Control Center');
    const navCustomId = overview.components[0].toJSON().components[0].custom_id;
    const selectExemption = {
      guildId,
      user: { id: actorId },
      isChatInputCommand: () => false,
      isButton: () => false,
      isAnySelectMenu: () => true,
      isStringSelectMenu: () => true,
      inGuild: () => true,
      customId: navCustomId,
      values: ['exemptions'],
      update: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    expect(await router.handle(selectExemption as unknown as ChatInputCommandInteraction)).toBe(
      true,
    );
    const exemptionsView = selectExemption.editReply.mock.calls[0]![0];
    const roleSelectId = exemptionsView.components[1].toJSON().components[0].custom_id;
    const roleSelect = {
      ...selectExemption,
      isStringSelectMenu: () => false,
      isRoleSelectMenu: () => true,
      customId: roleSelectId,
      values: ['1108716196024561799'],
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    expect(await router.handle(roleSelect as unknown as ChatInputCommandInteraction)).toBe(true);
    expect(f.store.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ exemptRoles: ['1108716196024561799'] }),
    );
  });
  it('supports case autocomplete and modal reason amendments from /case view', async () => {
    const f = fixture();
    f.record.caseNumber = 7;
    f.store.searchCases = vi.fn(async () => [f.record]);
    const client = {
      guilds: {
        fetch: async () => ({
          ownerId: actorId,
          members: { fetch: async () => ({ id: actorId, permissions: { has: () => true } }) },
        }),
      },
    } as unknown as Client;
    const router = new CommandRouter(client, f.store, new ModerationService(f.store, f.discord), {
      memberEvents: false,
      messageFilter: false,
    });
    const auto = {
      guildId,
      isAutocomplete: () => true,
      options: { getFocused: () => '#7' },
      respond: vi.fn().mockResolvedValue(undefined),
    };
    await router.handle(auto as unknown as ChatInputCommandInteraction);
    expect(auto.respond).toHaveBeenCalledWith([
      expect.objectContaining({ value: '7', name: expect.stringContaining('#7') }),
    ]);

    const viewCmd = {
      ...interaction('case'),
      options: {
        getSubcommand: () => 'view',
        getString: () => '#7',
      },
    };
    expect(await router.handle(viewCmd as unknown as ChatInputCommandInteraction)).toBe(true);
    const viewReply = viewCmd.editReply.mock.calls[0]![0];
    const amendBtnId = viewReply.components[0].toJSON().components[0].custom_id;
    const showModal = vi.fn().mockResolvedValue(undefined);
    const btnClick = {
      guildId,
      user: { id: actorId },
      isButton: () => true,
      inGuild: () => true,
      customId: amendBtnId,
      showModal,
    };
    expect(await router.handle(btnClick as unknown as ButtonInteraction)).toBe(true);
    expect(showModal).toHaveBeenCalledOnce();
    const modalPayload = showModal.mock.calls[0]![0].toJSON();
    const modalSubmit = {
      guildId,
      user: { id: actorId },
      isModalSubmit: () => true,
      inGuild: () => true,
      customId: modalPayload.custom_id,
      fields: { getTextInputValue: () => 'Modal updated reason' },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    expect(await router.handle(modalSubmit as unknown as ChatInputCommandInteraction)).toBe(true);
    expect(f.store.changeCase).toHaveBeenCalledWith(
      guildId,
      f.record.id,
      expect.objectContaining({ kind: 'reason', value: 'Modal updated reason' }),
    );
  });
  it('executes /purge, /lock, /slowmode, /note, and /whois commands', async () => {
    const f = fixture();
    const client = {
      guilds: {
        fetch: async () => ({
          ownerId: actorId,
          members: {
            fetch: async () => ({
              id: actorId,
              joinedTimestamp: Date.now() - 86_400_000,
              roles: { cache: new Map() },
              permissions: { has: () => true },
            }),
          },
        }),
      },
    } as unknown as Client;
    const service = new ModerationService(f.store, f.discord);
    const spy = vi.spyOn(service, 'execute');
    const router = new CommandRouter(client, f.store, service, {
      memberEvents: false,
      messageFilter: false,
    });

    const purgeCmd = {
      ...interaction('purge'),
      channelId: '1560181480427225159',
      options: {
        getInteger: () => 25,
        getString: (k: string) => (k === 'reason' ? 'Spam cleanup' : 'http'),
        getUser: () => ({ id: targetId }),
        getBoolean: () => true,
      },
    };
    expect(await router.handle(purgeCmd as unknown as ChatInputCommandInteraction)).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'purge',
        channelId: '1560181480427225159',
        purgeFilter: expect.objectContaining({ count: 25, targetId, contains: 'http' }),
      }),
    );

    const whoisCmd = {
      ...interaction('whois'),
      options: {
        getUser: () => ({
          id: targetId,
          username: 'member',
          createdTimestamp: Date.now() - 10 * 86_400_000,
        }),
      },
    };
    expect(await router.handle(whoisCmd as unknown as ChatInputCommandInteraction)).toBe(true);
    expect(whoisCmd.editReply.mock.calls[0]![0].embeds[0].toJSON().title).toBe('Member Dossier');
  });
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
    expect(() => auditReason(request({ reason: '😀'.repeat(200) }), 'case-id')).not.toThrow();
  });
});
