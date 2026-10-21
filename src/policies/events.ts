import {
  Client,
  Events,
  PermissionFlagsBits as P,
  type Message,
  type PartialMessage,
} from 'discord.js';
import type { Capabilities } from '../config.js';
import { resolveLogChannel } from '../domain.js';
import type { ModerationService } from '../moderation/service.js';
import type { Store } from '../storage/store.js';
import { errorCode, logger } from '../logger.js';
import { InviteResolver, PolicyService, inviteCodes } from './service.js';
import { textEmbed } from '../discord/presentation.js';
export function attachPolicies(
  client: Client,
  store: Store,
  moderation: ModerationService,
  capabilities: Capabilities,
  scope?: { guildId: string; targetId: string; channelId: string },
) {
  const resolver = new InviteResolver(
    async (code) => (await client.fetchInvite(code)).guild?.id ?? null,
  );
  const policies = new PolicyService(
    store,
    moderation,
    resolver,
    () => client.user!.id,
    async (guildId, text) => {
      const settings = await store.getSettings(guildId);
      const alertChannelId = resolveLogChannel(settings, 'alertLog');
      if (!alertChannelId) return;
      const channel = await (await client.guilds.fetch(guildId)).channels.fetch(alertChannelId);
      if (channel?.isSendable())
        await channel.send({
          embeds: [textEmbed('Policy check needs attention', text, 'warning')],
          allowedMentions: { parse: [] },
        });
    },
  );
  const report = (error: unknown) =>
    logger.warn({ code: errorCode(error) }, 'Automated policy failed. Check /doctor.');
  let active = 0;
  let warnedAt = 0;
  const dispatch = (operation: () => Promise<unknown>) => {
    if (active >= 16) {
      if (Date.now() - warnedAt > 60_000) {
        logger.warn('Policy capacity reached. Some checks were skipped; review server activity.');
        warnedAt = Date.now();
      }
      return;
    }
    active++;
    void operation()
      .catch(report)
      .finally(() => {
        active--;
      });
  };
  if (capabilities.memberEvents)
    client.on(Events.GuildMemberAdd, (member) => {
      if (scope && (member.guild.id !== scope.guildId || member.id !== scope.targetId)) return;
      dispatch(() =>
        policies.joined({
          guildId: member.guild.id,
          userId: member.id,
          bot: member.user.bot,
          permissions: member.permissions.bitfield,
          roles: [...member.roles.cache.keys()],
          createdAt: member.user.createdTimestamp,
          joinedAt: member.joinedAt?.toISOString() ?? new Date().toISOString(),
        }),
      );
    });
  if (capabilities.messageFilter) {
    const message = async (raw: Message | PartialMessage) => {
      if (!raw.guildId || raw.author?.bot) return;
      if (
        scope &&
        (raw.guildId !== scope.guildId ||
          raw.channelId !== scope.channelId ||
          (raw.author && raw.author.id !== scope.targetId))
      )
        return;
      if (!raw.partial && !inviteCodes(raw.content).length) return;
      const full = raw.partial ? await raw.fetch() : raw;
      if (!full.guild || !full.author || !full.content) return;
      if (scope && full.author.id !== scope.targetId) return;
      if (!inviteCodes(full.content).length) return;
      const member = await full.guild.members.fetch({ user: full.author.id, force: true });
      if (member.permissions.has(P.Administrator)) return;
      await policies.message({
        guildId: full.guild.id,
        userId: full.author.id,
        bot: full.author.bot,
        permissions: member.permissions.bitfield,
        roles: [...member.roles.cache.keys()],
        channelId: full.channelId,
        messageId: full.id,
        content: full.content,
      });
    };
    client.on(Events.MessageCreate, (raw) => {
      dispatch(() => message(raw));
    });
    client.on(Events.MessageUpdate, (_before, raw) => {
      dispatch(() => message(raw));
    });
  }
}
