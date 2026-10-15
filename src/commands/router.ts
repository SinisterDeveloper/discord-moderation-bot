import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits as P,
  escapeMarkdown,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type InteractionEditReplyOptions,
} from 'discord.js';
import { parseDuration, reasonSchema, snowflake, type Capabilities } from '../config.js';
import {
  UserError,
  type Action,
  type ActionRequest,
  type GuildSettings,
  type Preset,
} from '../domain.js';
import { caseSummary } from '../discord/adapter.js';
import { errorCode, logger } from '../logger.js';
import type { ModerationService } from '../moderation/service.js';
import type { Store } from '../storage/store.js';
import { Sessions } from './sessions.js';
export interface NativeCommands {
  status(guildId: string): Promise<string>;
  configure(
    guildId: string,
    preset: Preset,
    input: { limit: number | null; categories: string | null; keywords: string | null },
  ): Promise<string>;
  preview(
    guildId: string,
    preset: Preset,
    enabled: boolean,
  ): Promise<{ text: string; fingerprint: string }>;
  apply(guildId: string, preset: Preset, enabled: boolean, fingerprint: string): Promise<string>;
}
type Reply = InteractionEditReplyOptions;
type Callback = (button: ButtonInteraction) => Promise<Reply>;
export class CommandRouter {
  private sessions = new Sessions<Callback>();
  private lastUse = new Map<string, number>();
  constructor(
    private readonly client: Client,
    private readonly store: Store,
    private readonly service: ModerationService,
    private readonly capabilities: Capabilities,
    private readonly native?: NativeCommands,
  ) {}
  private async requirePermission(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    permission: bigint,
  ) {
    if (!interaction.guildId) throw new UserError('Use this command in a server.');
    const guild = await this.client.guilds.fetch(interaction.guildId);
    const member = await guild.members.fetch({ user: interaction.user.id, force: true });
    if (member.id !== guild.ownerId && !member.permissions.has(permission))
      throw new UserError('You do not have permission for this command.');
  }
  private button(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    label: string,
    callback: Callback,
    danger = false,
  ) {
    const id = this.sessions.create(interaction.user.id, interaction.guildId!, callback);
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`v3:${id}`)
        .setLabel(label)
        .setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Primary),
    );
  }
  async handle(interaction: Interaction) {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'Use this command in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    try {
      if (interaction.isButton()) {
        if (!interaction.customId.startsWith('v3:')) return;
        const callback = this.sessions.take(
          interaction.customId.slice(3),
          interaction.user.id,
          interaction.guildId,
        );
        await interaction.update({ content: 'Checking this request…', embeds: [], components: [] });
        await interaction.editReply(await callback(interaction));
      } else {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const key = `${interaction.guildId}:${interaction.user.id}:${interaction.commandName}`;
        if ((this.lastUse.get(key) ?? 0) > Date.now())
          throw new UserError('Wait one second before repeating this command.');
        if (this.lastUse.size >= 5000) this.lastUse.delete(this.lastUse.keys().next().value!);
        this.lastUse.set(key, Date.now() + 1000);
        await interaction.editReply(await this.chat(interaction));
      }
      return true;
    } catch (error) {
      const ref = errorCode(error);
      logger.warn({ code: ref, guildId: interaction.guildId }, 'Command failed.');
      const content =
        error instanceof UserError
          ? error.message
          : `The request could not be completed. Reference: ${ref}. Check /doctor or the service logs.`;
      if (interaction.deferred || interaction.replied)
        await interaction.editReply({ content, embeds: [], components: [] }).catch(() => {});
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      return false;
    }
  }
  private async actionResult(request: ActionRequest): Promise<Reply> {
    const result = await this.service.execute(request);
    if (result.noop)
      return {
        content:
          'No change needed. The requested restriction is already absent or the user is already banned.',
        components: [],
      };
    const record = result.record!;
    return {
      content: `${result.duplicate ? 'Existing request result:\n' : ''}${caseSummary(record)}${record.state === 'unknown' ? '\nStaff must verify this result before taking another action.' : ''}`,
      components: [],
    };
  }
  private async history(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    target: string,
    cursor?: string,
  ): Promise<Reply> {
    await this.requirePermission(interaction, P.ModerateMembers);
    const page = await this.store.listCases(interaction.guildId!, target, cursor);
    if (!page.records.length) return { content: 'No cases found.', embeds: [], components: [] };
    const embed = new EmbedBuilder()
      .setTitle(`Cases for ${target}`)
      .setColor(0x5865f2)
      .addFields(
        page.records.map((record) => ({
          name: `${record.action} · ${record.state}${record.revoked ? ' · revoked' : ''}`,
          value: `ID: \`${record.id}\`\n${escapeMarkdown(record.reason.slice(0, 160))}\n<t:${Math.floor(record.createdAt.getTime() / 1000)}:f>`,
        })),
      );
    const cursorNext = page.next;
    return {
      content: '',
      embeds: [embed],
      components: cursorNext
        ? [
            this.button(interaction, 'Next page', (button) =>
              this.history(button, target, cursorNext),
            ),
          ]
        : [],
    };
  }
  private async setLogChannel(settings: GuildSettings, channelId: string) {
    const guild = await this.client.guilds.fetch(settings.guildId);
    const channel = await guild.channels.fetch(channelId);
    const bot = await guild.members.fetchMe({ force: true });
    if (
      !channel?.isSendable() ||
      !channel.permissionsFor(bot)?.has([P.ViewChannel, P.SendMessages])
    )
      throw new UserError('Choose a text channel where the bot can view and send messages.');
    settings.logChannelId = channelId;
  }
  private async config(interaction: ChatInputCommandInteraction): Promise<Reply> {
    await this.requirePermission(interaction, P.ManageGuild);
    const settings = await this.store.getSettings(interaction.guildId!);
    const o = interaction.options;
    const sub = interaction.commandName === 'setup' ? 'setup' : o.getSubcommand();
    switch (sub) {
      case 'view':
        return {
          content: `Staff channel: ${settings.logChannelId ?? 'not set'}\nAction DMs: ${settings.dmEnabled}\nAccount age: ${settings.accountAge.enabled ? `${settings.accountAge.days} days, ${settings.accountAge.action}` : 'disabled'}\nInvite filter: ${settings.invites.enabled}\nExempt roles: ${settings.exemptRoles.join(', ') || 'none'}\nExempt channels: ${settings.exemptChannels.join(', ') || 'none'}\nLegacy mute role: ${settings.legacyMuteRoleId ?? 'none'}`,
        };
      case 'setup':
        await this.setLogChannel(settings, o.getChannel('log-channel', true).id);
        break;
      case 'log-channel':
        await this.setLogChannel(settings, o.getChannel('channel', true).id);
        break;
      case 'notifications':
        settings.dmEnabled = o.getBoolean('dm', true);
        break;
      case 'account-age': {
        const enabled = o.getBoolean('enabled', true);
        if (enabled && !this.capabilities.memberEvents)
          throw new UserError(
            'Enable member events in runtime configuration and restart before enabling this policy.',
          );
        const days = o.getInteger('days') ?? settings.accountAge.days;
        const action = (o.getString('action') ?? settings.accountAge.action) as 'alert' | 'kick';
        if (!Number.isInteger(days) || days < 1 || days > 3650)
          throw new UserError('Days must be a whole number from 1 to 3650.');
        if (enabled && action === 'kick') await this.requirePermission(interaction, P.KickMembers);
        settings.accountAge = { enabled, days, action };
        break;
      }
      case 'invites': {
        const enabled = o.getBoolean('enabled', true);
        if (enabled && !this.capabilities.messageFilter)
          throw new UserError(
            'Enable message filtering in runtime configuration and restart before enabling this policy.',
          );
        settings.invites.enabled = enabled;
        break;
      }
      case 'exempt-role':
      case 'exempt-channel': {
        const role = sub === 'exempt-role';
        const value = role ? o.getRole('role', true).id : o.getChannel('channel', true).id;
        if (role && value === interaction.guildId)
          throw new UserError('The everyone role cannot be exempt. Disable the policy instead.');
        const key = role ? 'exemptRoles' : 'exemptChannels';
        settings[key] =
          o.getString('operation', true) === 'add'
            ? [...new Set([...settings[key], value])]
            : settings[key].filter((id) => id !== value);
        if (settings[key].length > (role ? 20 : 50))
          throw new UserError('The exemption list is full.');
        break;
      }
      default:
        throw new UserError('Unknown configuration operation.');
    }
    if ((settings.accountAge.enabled || settings.invites.enabled) && !settings.logChannelId)
      throw new UserError('Run /setup to choose a staff log channel first.');
    await this.store.saveSettings(settings);
    return {
      content: 'Settings saved. Native AutoMod exemptions take effect when you apply each preset.',
    };
  }
  private async chat(interaction: ChatInputCommandInteraction): Promise<Reply> {
    const name = interaction.commandName;
    const o = interaction.options;
    const guildId = interaction.guildId!;
    if (name === 'ping')
      return {
        content: `Pong. Gateway: ${this.client.ws.ping} ms. Database: ${this.store.available() ? 'ready' : 'unavailable'}.`,
      };
    if (name === 'help')
      return {
        content:
          'Moderation: /ban, /kick, /unban, /warn, /timeout, /untimeout.\nHistory: /cases, /case view.\nManagement: /setup, /config, /automod, /doctor, /case reason, /case revoke, /case resolve.\nImported restrictions: /legacy-unmute.\nUse /doctor to check missing access. New timeouts last at most 28 days.',
      };
    if (name === 'doctor') {
      await this.requirePermission(interaction, P.ManageGuild);
      if (!this.store.available())
        return { content: 'Database unavailable. New bot-run actions are paused.' };
      const settings = await this.store.getSettings(guildId);
      const guild = await this.client.guilds.fetch(guildId);
      const bot = await guild.members.fetchMe({ force: true });
      const lines = [
        `Database: ready. Uncertain cases: ${await this.store.unresolved(guildId)}.`,
        `Capabilities: member events ${this.capabilities.memberEvents}; message filter ${this.capabilities.messageFilter}.`,
        `Staff channel: ${settings.logChannelId ?? 'not set'}.`,
        `Bot permissions: ban ${bot.permissions.has(P.BanMembers)}, kick ${bot.permissions.has(P.KickMembers)}, timeout ${bot.permissions.has(P.ModerateMembers)}, AutoMod ${bot.permissions.has(P.ManageGuild)}.`,
      ];
      if (settings.accountAge.enabled && !this.capabilities.memberEvents)
        lines.push('FAULT: account-age checks need member events.');
      if (settings.invites.enabled && !this.capabilities.messageFilter)
        lines.push('FAULT: invite filtering needs message content access.');
      if (settings.logChannelId) {
        try {
          await this.setLogChannel(settings, settings.logChannelId);
        } catch {
          lines.push('FAULT: staff channel is missing or inaccessible.');
        }
      }
      if (this.native && bot.permissions.has(P.ManageGuild))
        lines.push(await this.native.status(guildId));
      return { content: lines.join('\n').slice(0, 1950) };
    }
    if (name === 'setup' || name === 'config') return this.config(interaction);
    if (name === 'cases') return this.history(interaction, o.getUser('user', true).id);
    if (name === 'case') {
      const sub = o.getSubcommand();
      await this.requirePermission(interaction, sub === 'view' ? P.ModerateMembers : P.ManageGuild);
      const record = await this.store.getCase(guildId, o.getString('id', true));
      if (!record) throw new UserError('Case not found in this server.');
      if (sub === 'view')
        return {
          content: `${caseSummary(record)}\nChanges: ${record.changes.length}.\n${record.changes
            .slice(-3)
            .map((c) => `${c.kind} by ${c.actorId}: ${escapeMarkdown(c.value).slice(0, 160)}`)
            .join('\n')}`.slice(0, 1950),
        };
      const kind = sub === 'reason' ? 'reason' : sub === 'revoke' ? 'revoke' : 'resolve';
      const value = reasonSchema.parse(
        o.getString(kind === 'resolve' ? 'evidence' : 'reason', true),
      );
      const outcome =
        kind === 'resolve' ? (o.getString('outcome', true) as 'succeeded' | 'failed') : undefined;
      const changed = await this.store.changeCase(
        guildId,
        record.id,
        {
          actorId: interaction.user.id,
          at: new Date(),
          kind,
          value,
          previous: kind === 'reason' ? record.reason : record.state,
        },
        outcome,
      );
      return { content: caseSummary(changed) };
    }
    if (name === 'automod') {
      await this.requirePermission(interaction, P.ManageGuild);
      if (!this.native) throw new UserError('Native AutoMod is not available in this build.');
      const native = this.native;
      const sub = o.getSubcommand();
      if (sub === 'status') return { content: await native.status(guildId) };
      const preset = o.getString('preset', true) as Preset;
      if (sub === 'configure')
        return {
          content: await native.configure(guildId, preset, {
            limit: o.getInteger('limit'),
            categories: o.getString('categories'),
            keywords: o.getString('keywords'),
          }),
        };
      const enabled = sub === 'apply';
      const preview = await native.preview(guildId, preset, enabled);
      return {
        content: preview.text,
        components: [
          this.button(
            interaction,
            enabled ? 'Apply rule' : 'Disable rule',
            async (button) => {
              await this.requirePermission(button, P.ManageGuild);
              return {
                content: await native.apply(guildId, preset, enabled, preview.fingerprint),
                components: [],
              };
            },
            !enabled,
          ),
        ],
      };
    }
    const action = name.replace('-', '_') as Action;
    if (!['ban', 'unban', 'kick', 'warn', 'timeout', 'untimeout', 'legacy_unmute'].includes(action))
      throw new UserError('Unknown command. Redeploy the current command definitions.');
    const target =
      action === 'ban' || action === 'unban'
        ? o.getString(action === 'ban' ? 'target' : 'user-id', true).replace(/^<@!?(\d+)>$/, '$1')
        : o.getUser('user', true).id;
    if (!snowflake.safeParse(target).success)
      throw new UserError('Use a valid user ID or mention.');
    const request: ActionRequest = {
      guildId,
      targetId: target,
      actorId: interaction.user.id,
      source: 'manual',
      requestKey: interaction.id,
      action,
      reason: reasonSchema.parse(o.getString('reason', true)),
    };
    if (action === 'timeout') request.durationMs = parseDuration(o.getString('duration', true));
    if (action === 'ban' || action === 'kick') {
      await this.service.validate(request);
      return {
        content: `Confirm ${action} for ${target}. Reason: ${escapeMarkdown(request.reason)}\nThis request expires in 60 seconds.`,
        components: [
          this.button(interaction, `Confirm ${action}`, () => this.actionResult(request), true),
        ],
      };
    }
    return this.actionResult(request);
  }
}
