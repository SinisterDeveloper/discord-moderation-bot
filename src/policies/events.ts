import {
  Client,
  Events,
  PermissionFlagsBits as P,
  type Message,
  type PartialMessage,
} from 'discord.js';
import type { Capabilities } from '../config.js';
import type { ModerationService } from '../moderation/service.js';
import type { Store } from '../storage/store.js';
import { errorCode, logger } from '../logger.js';
import { InviteResolver, PolicyService } from './service.js';
export function attachPolicies(
  client: Client,
  store: Store,
  moderation: ModerationService,
  capabilities: Capabilities,
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
      if (!settings.logChannelId) return;
      const channel = await (
        await client.guilds.fetch(guildId)
      ).channels.fetch(settings.logChannelId);
      if (channel?.isSendable())
        await channel.send({ content: text, allowedMentions: { parse: [] } });
    },
  );
  const report = (error: unknown) =>
    logger.warn({ code: errorCode(error) }, 'Automated policy failed. Check /doctor.');
  if (capabilities.memberEvents)
    client.on(Events.GuildMemberAdd, (member) => {
      void policies
        .joined({
          guildId: member.guild.id,
          userId: member.id,
          bot: member.user.bot,
          permissions: member.permissions.bitfield,
          roles: [...member.roles.cache.keys()],
          createdAt: member.user.createdTimestamp,
          joinedAt: member.joinedAt?.toISOString() ?? new Date().toISOString(),
        })
        .catch(report);
    });
  if (capabilities.messageFilter) {
    const message = async (raw: Message | PartialMessage) => {
      if (!raw.guildId || raw.author?.bot) return;
      const full = raw.partial ? await raw.fetch() : raw;
      if (!full.guild || !full.author || !full.content) return;
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
      void message(raw).catch(report);
    });
    client.on(Events.MessageUpdate, (_before, raw) => {
      void message(raw).catch(report);
    });
  }
}
