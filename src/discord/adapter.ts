import { Client, DiscordAPIError, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import {
  ActionFailure,
  UserError,
  type ActionRequest,
  type GuildSettings,
  type ModerationCase,
} from '../domain.js';
import { checkPermissions } from '../moderation/permissions.js';
import type { DiscordPort } from '../moderation/service.js';
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
  let text = prefix + request.reason;
  while (encodeURIComponent(text).length > 512) text = text.slice(0, -1);
  return text;
}
export function caseSummary(record: ModerationCase) {
  return `Case ${record.id}\nAction: ${record.action}; outcome: ${record.state}${record.revoked ? ' (warning revoked)' : ''}\nUser: ${record.targetId}\nActor: ${record.actorId}\nReason: ${escapeMarkdown(record.reason)}\nCreated: <t:${Math.floor(record.createdAt.getTime() / 1000)}:f>\nDeliveries: DM ${record.dm.status}, staff ${record.staff.status}.${record.errorCode ? `\nReference: ${record.errorCode}` : ''}`;
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
    if (request.action === 'unban' || request.action === 'ban') {
      let banned = false;
      try {
        await guild.bans.fetch(request.targetId);
        banned = true;
      } catch (error) {
        if (!(error instanceof DiscordAPIError && error.code === 10026)) throw error;
      }
      if ((request.action === 'unban' && !banned) || (request.action === 'ban' && banned))
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
    if (request.action === 'invite_delete') {
      const channel = request.channelId ? await guild.channels.fetch(request.channelId) : null;
      if (
        !channel?.isTextBased() ||
        !channel.permissionsFor(bot)?.has(PermissionFlagsBits.ManageMessages)
      )
        throw new UserError('The bot needs Manage Messages in this channel.');
    }
    return 'allowed';
  }
  async perform(request: ActionRequest, caseId: string, settings: GuildSettings) {
    try {
      const guild = await this.client.guilds.fetch(request.guildId);
      const reason = auditReason(request, caseId);
      switch (request.action) {
        case 'ban':
          await guild.members.ban(request.targetId, { reason });
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
        case 'warn':
        case 'account_age_alert':
          break;
      }
    } catch (error) {
      throw failure(error);
    }
  }
  async sendDM(record: ModerationCase) {
    try {
      const user = await this.client.users.fetch(record.targetId);
      await user.send({
        content: `Moderation notice for server ${record.guildId}\n${caseSummary(record)}`,
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
      return (await channel.send({ content: caseSummary(record), allowedMentions: { parse: [] } }))
        .id;
    } catch (error) {
      throw failure(error);
    }
  }
}
