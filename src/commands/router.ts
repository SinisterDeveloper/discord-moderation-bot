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
import { parseDuration, parseReason, snowflake, type Capabilities } from '../config.js';
import {
  UserError,
  type Action,
  type ActionRequest,
  type GuildSettings,
  type Preset,
} from '../domain.js';
import {
  actionLabel,
  caseEmbed,
  caseStatus,
  embedReply,
  person,
  settingsEmbed,
  textEmbed,
} from '../discord/presentation.js';
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
        ...embedReply(textEmbed('Server command', 'Use this command in a server.', 'warning')),
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
        await interaction.update(embedReply(textEmbed('Checking request', 'Please wait.')));
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
      const response = embedReply(
        textEmbed(
          'Request not completed',
          content,
          error instanceof UserError ? 'warning' : 'error',
        ),
      );
      if (interaction.deferred || interaction.replied)
        await interaction.editReply(response).catch(() => {});
      else await interaction.reply({ ...response, flags: MessageFlags.Ephemeral }).catch(() => {});
      return false;
    }
  }
  private async actionResult(request: ActionRequest): Promise<Reply> {
    const result = await this.service.execute(request);
    if (result.noop)
      return embedReply(
        textEmbed(
          'No change needed',
          'The requested restriction is already absent or the user is already banned.',
        ),
      );
    const record = result.record!;
    const embed = caseEmbed(record);
    if (result.duplicate) embed.setAuthor({ name: 'Existing request result' });
    return embedReply(embed);
  }
  private async history(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    target: string,
    cursor?: string,
  ): Promise<Reply> {
    await this.requirePermission(interaction, P.ModerateMembers);
    const page = await this.store.listCases(interaction.guildId!, target, cursor);
    if (!page.records.length)
      return embedReply(textEmbed('Case history', `No cases found for ${person(target)}.`));
    const embed = new EmbedBuilder()
      .setTitle('Case history')
      .setDescription(person(target))
      .setColor(0x5865f2)
      .addFields(
        page.records.map((record) => ({
          name: `${actionLabel[record.action]} · ${caseStatus(record)}`,
          value: `\`${record.id}\` · <t:${Math.floor(record.createdAt.getTime() / 1000)}:d>\n${escapeMarkdown(record.reason.slice(0, 100))}${record.reason.length > 100 ? '…' : ''}`,
        })),
      )
      .setFooter({ text: 'Newest first · Use /case view for details' });
    const cursorNext = page.next;
    return {
      ...embedReply(embed),
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
      !channel.permissionsFor(bot)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks])
    )
      throw new UserError(
        'Choose a text channel where the bot can view messages, send messages, and embed links.',
      );
    settings.logChannelId = channelId;
  }
  private async config(interaction: ChatInputCommandInteraction): Promise<Reply> {
    await this.requirePermission(interaction, P.ManageGuild);
    const settings = await this.store.getSettings(interaction.guildId!);
    const o = interaction.options;
    const sub = interaction.commandName === 'setup' ? 'setup' : o.getSubcommand();
    switch (sub) {
      case 'view':
        return embedReply(settingsEmbed(settings));
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
    return embedReply(
      textEmbed(
        'Settings saved',
        sub === 'setup' || sub === 'log-channel'
          ? `Staff logs will go to <#${settings.logChannelId}>.`
          : sub === 'exempt-role' || sub === 'exempt-channel'
            ? 'Exemptions updated. Apply each native AutoMod preset to update its exemptions.'
            : 'Your server settings have been updated.',
        'success',
      ),
    );
  }
  private async chat(interaction: ChatInputCommandInteraction): Promise<Reply> {
    const name = interaction.commandName;
    const o = interaction.options;
    const guildId = interaction.guildId!;
    if (name === 'ping')
      return embedReply(
        textEmbed(
          'Pong',
          `**Gateway** ${this.client.ws.ping < 0 ? 'Measuring…' : `${this.client.ws.ping} ms`} · **Database** ${this.store.available() ? 'Ready' : 'Unavailable'}`,
          this.store.available() ? 'success' : 'warning',
        ),
      );
    if (name === 'help')
      return embedReply(
        textEmbed('Command guide', 'Choose a command to see its options.')
          .addFields(
            {
              name: 'Moderation',
              value: '`/ban` `/unban` `/kick` `/warn` `/timeout` `/untimeout` `/legacy-unmute`',
            },
            {
              name: 'Cases',
              value: '`/cases` `/case view` `/case reason` `/case revoke` `/case resolve`',
            },
            { name: 'Server setup', value: '`/setup` `/config` `/automod` `/doctor`' },
          )
          .setFooter({ text: 'Replies are private · Timeouts last at most 28 days' }),
      );
    if (name === 'doctor') {
      await this.requirePermission(interaction, P.ManageGuild);
      if (!this.store.available())
        return embedReply(
          textEmbed(
            'System check',
            'Database unavailable. New bot-run actions are paused.',
            'error',
          ),
        );
      const settings = await this.store.getSettings(guildId);
      const guild = await this.client.guilds.fetch(guildId);
      const bot = await guild.members.fetchMe({ force: true });
      const missing = [
        ['Ban Members', P.BanMembers],
        ['Kick Members', P.KickMembers],
        ['Moderate Members', P.ModerateMembers],
        ['Manage Messages', P.ManageMessages],
        ['Manage Roles', P.ManageRoles],
        ['Manage Server', P.ManageGuild],
      ] as const;
      const missingPermissions = missing
        .filter(([, permission]) => !bot.permissions.has(permission))
        .map(([label]) => label);
      const faults: string[] = [];
      const unknown = await this.store.listUnresolved(guildId);
      if (settings.accountAge.enabled && !this.capabilities.memberEvents)
        faults.push('Account-age checks need member events.');
      if (settings.invites.enabled && !this.capabilities.messageFilter)
        faults.push('Invite filtering needs message content access.');
      let staffChannel = 'Not set. Use /setup.';
      if (settings.logChannelId) {
        try {
          await this.setLogChannel(settings, settings.logChannelId);
          staffChannel = `<#${settings.logChannelId}>`;
        } catch {
          staffChannel = 'Missing or inaccessible. Use /setup.';
          faults.push('The bot cannot send staff logs.');
        }
      }
      const nativeStatus =
        this.native && bot.permissions.has(P.ManageGuild)
          ? await this.native.status(guildId)
          : null;
      const needsAttention =
        faults.length > 0 ||
        missingPermissions.length > 0 ||
        unknown.length > 0 ||
        !settings.logChannelId ||
        (nativeStatus && /FAULT:|external changes/i.test(nativeStatus));
      const embed = textEmbed(
        'System check',
        `**Discord** Connected · **Database** Ready${needsAttention ? '\nSome checks need attention.' : ''}`,
        needsAttention ? 'warning' : 'success',
      ).addFields(
        { name: 'Staff logs', value: staffChannel, inline: true },
        {
          name: 'Policy access',
          value: `Member events: ${this.capabilities.memberEvents ? 'On' : 'Off'}\nMessage filtering: ${this.capabilities.messageFilter ? 'On' : 'Off'}`,
          inline: true,
        },
      );
      if (missingPermissions.length)
        embed.addFields({ name: 'Missing permissions', value: missingPermissions.join(', ') });
      if (nativeStatus) embed.addFields({ name: 'Native AutoMod', value: nativeStatus });
      if (faults.length) embed.addFields({ name: 'Faults', value: faults.join('\n') });
      if (unknown.length) {
        const count = await this.store.unresolved(guildId);
        embed.addFields({
          name: `Uncertain cases (${count})`,
          value: unknown
            .map(
              (record) =>
                `\`${record.id}\` · ${actionLabel[record.action]} · ${person(record.targetId)}`,
            )
            .join('\n'),
        });
        embed.setFooter({
          text: 'Oldest 10 shown · Use /case view, then /case resolve with evidence',
        });
      }
      return embedReply(embed);
    }
    if (name === 'setup' || name === 'config') return this.config(interaction);
    if (name === 'cases') return this.history(interaction, o.getUser('user', true).id);
    if (name === 'case') {
      const sub = o.getSubcommand();
      await this.requirePermission(interaction, sub === 'view' ? P.ModerateMembers : P.ManageGuild);
      const record = await this.store.getCase(guildId, o.getString('id', true));
      if (!record) throw new UserError('Case not found in this server.');
      if (sub === 'view') return embedReply(caseEmbed(record, true));
      const kind = sub === 'reason' ? 'reason' : sub === 'revoke' ? 'revoke' : 'resolve';
      const value = parseReason(o.getString(kind === 'resolve' ? 'evidence' : 'reason', true));
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
      return embedReply(
        caseEmbed(changed).setAuthor({
          name:
            kind === 'reason'
              ? 'Reason updated'
              : kind === 'revoke'
                ? 'Warning revoked'
                : 'Outcome resolved',
        }),
      );
    }
    if (name === 'automod') {
      await this.requirePermission(interaction, P.ManageGuild);
      if (!this.native) throw new UserError('Native AutoMod is not available in this build.');
      const native = this.native;
      const sub = o.getSubcommand();
      if (sub === 'status')
        return embedReply(textEmbed('Native AutoMod', await native.status(guildId)));
      const preset = o.getString('preset', true) as Preset;
      if (sub === 'configure')
        return embedReply(
          textEmbed(
            'Preset saved',
            await native.configure(guildId, preset, {
              limit: o.getInteger('limit'),
              categories: o.getString('categories'),
              keywords: o.getString('keywords'),
            }),
            'success',
          ),
        );
      const enabled = sub === 'apply';
      const preview = await native.preview(guildId, preset, enabled);
      return {
        ...embedReply(textEmbed('Review AutoMod change', preview.text, 'warning')),
        components: [
          this.button(
            interaction,
            enabled ? 'Apply rule' : 'Disable rule',
            async (button) => {
              await this.requirePermission(button, P.ManageGuild);
              return embedReply(
                textEmbed(
                  enabled ? 'AutoMod enabled' : 'AutoMod disabled',
                  await native.apply(guildId, preset, enabled, preview.fingerprint),
                  'success',
                ),
              );
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
      reason: parseReason(o.getString('reason', true)),
    };
    if (action === 'timeout') request.durationMs = parseDuration(o.getString('duration', true));
    if (action === 'ban' || action === 'kick') {
      await this.service.validate(request);
      return {
        ...embedReply(
          textEmbed(`Confirm ${action}`, escapeMarkdown(request.reason), 'warning')
            .addFields({ name: 'Member', value: person(target) })
            .setFooter({ text: 'Expires in 60 seconds' }),
        ),
        components: [
          this.button(interaction, `Confirm ${action}`, () => this.actionResult(request), true),
        ],
      };
    }
    return this.actionResult(request);
  }
}
