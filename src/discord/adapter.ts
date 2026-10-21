import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  DiscordAPIError,
  PermissionFlagsBits,
} from 'discord.js';
import {
  ActionFailure,
  UserError,
  type ActionRequest,
  type GuildSettings,
  type ModerationCase,
} from '../domain.js';
import { checkPermissions } from '../moderation/permissions.js';
import type { DiscordPort } from '../moderation/service.js';
import { caseEmbed } from './presentation.js';
export function failure(error: unknown): ActionFailure {
  if (error instanceof ActionFailure) return error;
  return new ActionFailure(
    error instanceof DiscordAPIError ? String(error.code) : 'NETWORK_OR_INTERNAL',
    error instanceof DiscordAPIError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429,
  );
}
export function auditReason(request: ActionRequest, caseId: string) {
  const prefix = `Case ${caseId}; actor ${request.actorId}; `;
  const characters = Array.from(Buffer.from(request.reason).toString('utf8'));
  while (encodeURIComponent(prefix + characters.join('')).length > 512) characters.pop();
  return prefix + characters.join('');
}
export class DiscordAdapter implements DiscordPort {
  constructor(readonly client: Client) {}
  async authorize(request: ActionRequest, settings: GuildSettings): Promise<'allowed' | 'noop'> {
    const guild = await this.client.guilds.fetch(request.guildId);
    const bot = await guild.members.fetchMe({ force: true });
    const actor =
      request.source === 'manual'
        ? await guild.members.fetch({ user: request.actorId, force: true })
        : bot;
    let target = null;
    try {
      target = await guild.members.fetch({ user: request.targetId, force: true });
    } catch (error) {
      if (!(error instanceof DiscordAPIError && error.code === 10007)) throw error;
    }
    if (request.source === 'account_age' || request.source === 'invite_filter') {
      if (
        target?.user.bot ||
        target?.permissions.has(PermissionFlagsBits.Administrator) ||
        target?.roles.cache.some((role) => settings.exemptRoles.includes(role.id))
      )
        return 'noop';
      if (request.source === 'account_age') {
        if (
          !target ||
          !settings.accountAge.enabled ||
          (Date.now() - target.user.createdTimestamp) / 86_400_000 >= settings.accountAge.days
        )
          return 'noop';
        if (request.joinedAt && target.joinedAt?.toISOString() !== request.joinedAt) return 'noop';
        if ((request.action === 'kick') !== (settings.accountAge.action === 'kick')) return 'noop';
      }
      if (
        request.source === 'invite_filter' &&
        (!settings.invites.enabled || settings.exemptChannels.includes(request.channelId!))
      )
        return 'noop';
    }
    checkPermissions(request, {
      ownerId: guild.ownerId,
      botId: bot.id,
      actorPermissions: actor.permissions.bitfield,
      botPermissions: bot.permissions.bitfield,
      targetExists: target !== null,
      targetAdministrator: target?.permissions.has(PermissionFlagsBits.Administrator) ?? false,
      targetBot: target?.user.bot ?? false,
      actorAboveTarget: target
        ? actor.roles.highest.comparePositionTo(target.roles.highest) > 0
        : false,
      botAboveTarget: target
        ? bot.roles.highest.comparePositionTo(target.roles.highest) > 0
        : false,
    });
    if (request.action === 'unban' || request.action === 'ban' || request.action === 'tempban') {
      let banned = false;
      try {
        await guild.bans.fetch(request.targetId);
        banned = true;
      } catch (error) {
        if (!(error instanceof DiscordAPIError && error.code === 10026)) throw error;
      }
      if (
        (request.action === 'unban' && !banned) ||
        ((request.action === 'ban' || request.action === 'tempban') && banned)
      )
        return 'noop';
    }
    if (request.action === 'untimeout' && !target?.isCommunicationDisabled()) return 'noop';
    if (request.action === 'legacy_unmute') {
      if (!settings.legacyMuteRoleId || !target?.roles.cache.has(settings.legacyMuteRoleId))
        return 'noop';
      const role = await guild.roles.fetch(settings.legacyMuteRoleId);
      if (!role || role.managed || role.comparePositionTo(bot.roles.highest) >= 0)
        throw new UserError('The bot cannot remove the legacy mute role. Check role order.');
    }
    if (request.action === 'invite_delete' || request.action === 'purge') {
      const channel = request.channelId ? await guild.channels.fetch(request.channelId) : null;
      if (
        !channel?.isTextBased() ||
        !channel.permissionsFor(bot)?.has(PermissionFlagsBits.ManageMessages)
      )
        throw new UserError('The bot needs Manage Messages in this channel.');
    }
    if (['lock', 'unlock', 'slowmode'].includes(request.action)) {
      const channel = request.channelId ? await guild.channels.fetch(request.channelId) : null;
      if (
        !channel?.isTextBased() ||
        !channel.permissionsFor(bot)?.has(PermissionFlagsBits.ManageChannels)
      )
        throw new UserError('The bot needs Manage Channels in this channel.');
    }
    return 'allowed';
  }
  async perform(request: ActionRequest, caseId: string, settings: GuildSettings) {
    try {
      const guild = await this.client.guilds.fetch(request.guildId);
      const reason = auditReason(request, caseId);
      switch (request.action) {
        case 'ban':
        case 'tempban':
          await guild.members.ban(request.targetId, {
            reason,
            ...(request.deleteMessageSeconds
              ? { deleteMessageSeconds: request.deleteMessageSeconds }
              : {}),
          });
          break;
        case 'softban':
          await guild.members.ban(request.targetId, {
            reason,
            deleteMessageSeconds: request.deleteMessageSeconds ?? 86_400,
          });
          await guild.members.unban(request.targetId, reason);
          break;
        case 'unban':
          await guild.members.unban(request.targetId, reason);
          break;
        case 'kick':
          await guild.members.kick(request.targetId, reason);
          break;
        case 'timeout':
          await guild.members.edit(request.targetId, {
            communicationDisabledUntil: new Date(Date.now() + request.durationMs!),
            reason,
          });
          break;
        case 'untimeout':
          await guild.members.edit(request.targetId, { communicationDisabledUntil: null, reason });
          break;
        case 'legacy_unmute':
          await (
            await guild.members.fetch(request.targetId)
          ).roles.remove(settings.legacyMuteRoleId!, reason);
          break;
        case 'invite_delete': {
          const channel = await guild.channels.fetch(request.channelId!);
          if (!channel?.isTextBased()) throw new ActionFailure('CHANNEL_UNAVAILABLE', true);
          const message = await channel.messages.fetch(request.messageId!);
          if (message.author.id !== request.targetId)
            throw new ActionFailure('TARGET_MISMATCH', true);
          await message.delete();
          break;
        }
        case 'purge': {
          const channel = await guild.channels.fetch(request.channelId!);
          if (!channel?.isTextBased() || !('bulkDelete' in channel))
            throw new ActionFailure('CHANNEL_UNAVAILABLE', true);
          const filter = request.purgeFilter ?? { count: 10 };
          const fetched = await channel.messages.fetch({
            limit: Math.min(Math.max(filter.count, 1), 100),
          });
          const matching = fetched.filter((m) => {
            if (filter.targetId && m.author?.id !== filter.targetId) return false;
            if (filter.botsOnly && !m.author?.bot) return false;
            if (filter.attachmentsOnly && (!m.attachments || m.attachments.size === 0))
              return false;
            if (
              filter.contains &&
              !m.content?.toLowerCase().includes(filter.contains.toLowerCase())
            )
              return false;
            return true;
          });
          await channel.bulkDelete(matching, true);
          break;
        }
        case 'lock':
        case 'unlock': {
          const channel = await guild.channels.fetch(request.channelId!);
          if (!channel || !('permissionOverwrites' in channel))
            throw new ActionFailure('CHANNEL_UNAVAILABLE', true);
          const locking = request.action === 'lock';
          await channel.permissionOverwrites.edit(
            guild.id,
            {
              SendMessages: locking ? false : null,
              SendMessagesInThreads: locking ? false : null,
            },
            { reason },
          );
          break;
        }
        case 'slowmode': {
          const channel = await guild.channels.fetch(request.channelId!);
          if (!channel || !('setRateLimitPerUser' in channel))
            throw new ActionFailure('CHANNEL_UNAVAILABLE', true);
          await channel.setRateLimitPerUser(request.slowmodeSeconds ?? 0, reason);
          break;
        }
        case 'warn':
        case 'note':
        case 'account_age_alert':
        case 'raid_alert':
        case 'automod_block':
          break;
        case 'legacy_mute':
        case 'legacy_unknown':
          throw new ActionFailure('IMPORTED_ACTION_ONLY', true);
      }
    } catch (error) {
      throw failure(error);
    }
  }
  async sendDM(record: ModerationCase) {
    try {
      const user = await this.client.users.fetch(record.targetId);
      const appealable = ['ban', 'tempban', 'kick', 'warn', 'timeout'].includes(record.action);
      const components = appealable
        ? [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`v3a:open:${record.guildId}:${record.id}`)
                .setLabel('Submit Appeal')
                .setStyle(ButtonStyle.Secondary),
            ),
          ]
        : [];
      await user.send({
        embeds: [
          caseEmbed(record).setAuthor({
            name: this.client.guilds.cache.get(record.guildId)?.name ?? `Server ${record.guildId}`,
          }),
        ],
        components,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      throw failure(error);
    }
  }
  async sendStaff(record: ModerationCase) {
    try {
      if (!record.logChannelId) throw new ActionFailure('NO_LOG_CHANNEL', true);
      const guild = await this.client.guilds.fetch(record.guildId);
      const channel = await guild.channels.fetch(record.logChannelId);
      if (!channel?.isSendable()) throw new ActionFailure('CHANNEL_UNAVAILABLE', true);
      return (await channel.send({ embeds: [caseEmbed(record)], allowedMentions: { parse: [] } }))
        .id;
    } catch (error) {
      throw failure(error);
    }
  }
}
