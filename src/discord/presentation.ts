import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import type { Action, CaseState, GuildSettings, ModerationCase } from '../domain.js';

const colors = { info: 0x5865f2, success: 0x3ba55d, warning: 0xf0b232, error: 0xed4245 };
export type Tone = keyof typeof colors;
export const actionLabel: Record<Action, string> = {
  ban: 'Ban',
  tempban: 'Temporary ban',
  softban: 'Softban',
  unban: 'Unban',
  kick: 'Kick',
  warn: 'Warning',
  note: 'Staff note',
  timeout: 'Timeout',
  untimeout: 'Timeout removal',
  purge: 'Message purge',
  lock: 'Channel lock',
  unlock: 'Channel unlock',
  slowmode: 'Slowmode update',
  legacy_unmute: 'Legacy mute release',
  account_age_alert: 'Account-age alert',
  raid_alert: 'Raid join-spike alert',
  automod_block: 'AutoMod action',
  invite_delete: 'Invite removal',
  legacy_mute: 'Legacy mute',
  legacy_unknown: 'Legacy action',
};
const stateLabel: Record<CaseState, string> = {
  pending: 'Pending',
  executing: 'In progress',
  succeeded: 'Complete',
  failed: 'Failed',
  unknown: 'Needs review',
  legacy_unverified: 'Imported, unverified',
};
export const person = (id: string) => (/^\d{17,20}$/.test(id) ? `<@${id}>` : 'Unknown (legacy)');
export function textEmbed(title: string, description: string, tone: Tone = 'info') {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(colors[tone]);
}
export function embedReply(embed: EmbedBuilder) {
  return {
    content: '',
    embeds: [embed],
    components: [],
    allowedMentions: { parse: [] },
  };
}
export function caseStatus(record: Pick<ModerationCase, 'state' | 'revoked'>) {
  return record.revoked ? 'Revoked' : stateLabel[record.state];
}
export function caseRef(record: Pick<ModerationCase, 'id' | 'caseNumber'>) {
  return record.caseNumber ? `#${record.caseNumber} (${record.id})` : record.id;
}
export function caseEmbed(record: ModerationCase, details = false) {
  const tone: Tone = record.revoked
    ? 'info'
    : record.state === 'succeeded'
      ? 'success'
      : record.state === 'failed'
        ? 'error'
        : 'warning';
  const embed = textEmbed(
    `${actionLabel[record.action]} · ${caseStatus(record)}`,
    `${escapeMarkdown(record.reason)}${record.state === 'unknown' ? '\n\nVerify the result in Discord before you resolve this case.' : ''}`,
    tone,
  )
    .addFields(
      { name: 'Member', value: person(record.targetId), inline: true },
      { name: 'Moderator', value: person(record.actorId), inline: true },
    )
    .setFooter({ text: `Case ${caseRef(record)}` })
    .setTimestamp(record.createdAt);
  if (record.durationMs)
    embed.addFields({
      name: 'Duration',
      value: `${record.durationMs / 1000} seconds`,
      inline: true,
    });
  if (details || record.dm.status === 'failed' || record.staff.status === 'failed')
    embed.addFields({
      name: 'Delivery',
      value: `DM: ${record.dm.status} · Staff log: ${record.staff.status}`,
    });
  if (record.errorCode)
    embed.addFields({ name: 'Error reference', value: escapeMarkdown(record.errorCode) });
  if (details && record.changes.length)
    embed.addFields({
      name: `Recent changes (${record.changes.length} total)`,
      value: record.changes
        .slice(-3)
        .map(
          (change) =>
            `**${change.kind === 'reason' ? 'Reason updated' : change.kind === 'revoke' ? 'Warning revoked' : change.kind === 'appeal' ? 'Appeal recorded' : 'Outcome resolved'}** · ${person(change.actorId)}\n${escapeMarkdown(change.value.slice(0, 120))}`,
        )
        .join('\n\n'),
    });
  return embed;
}
export function settingsEmbed(settings: GuildSettings) {
  const age = settings.accountAge;
  const ch = settings.channels;
  const extraChannels = [
    ch?.alertLog ? `**Alert logs** <#${ch.alertLog}>` : null,
    ch?.appealLog ? `**Appeal logs** <#${ch.appealLog}>` : null,
    ch?.reportLog ? `**Report logs** <#${ch.reportLog}>` : null,
  ].filter((x): x is string => x !== null);
  const embed = textEmbed(
    'Server settings',
    [
      `**Staff logs** ${settings.logChannelId ? `<#${settings.logChannelId}>` : 'Not set'}`,
      ...extraChannels,
      `**Action DMs** ${settings.dmEnabled ? 'On' : 'Off'}`,
      `**Account age** ${age.enabled ? `${age.days} days · ${age.action === 'kick' ? 'Kick' : 'Alert'}` : 'Off'}`,
      `**Invite filter** ${settings.invites.enabled ? 'On' : 'Off'}`,
      ...(settings.escalations
        ? [
            `**Escalations** ${settings.escalations.enabled ? `On (${settings.escalations.rules.length} rules${settings.escalations.warnDecayDays ? ` · ${settings.escalations.warnDecayDays}d decay` : ''})` : 'Off'}`,
          ]
        : []),
      ...(settings.antiRaid
        ? [
            `**Anti-raid** ${settings.antiRaid.enabled ? `On (${settings.antiRaid.joinThreshold} joins/${settings.antiRaid.windowSeconds}s · ${settings.antiRaid.action})` : 'Off'}`,
          ]
        : []),
      ...(settings.auditSync
        ? [`**Audit sync** ${settings.auditSync.enabled ? 'On' : 'Off'}`]
        : []),
      ...(!settings.exemptRoles.length && !settings.exemptChannels.length
        ? ['**Exemptions** None']
        : []),
      ...(settings.legacyMuteRoleId
        ? [`**Legacy mute role** <@&${settings.legacyMuteRoleId}>`]
        : []),
    ].join('\n'),
  );
  if (settings.exemptRoles.length)
    embed.addFields({
      name: 'Exempt roles',
      value: settings.exemptRoles.map((id) => `<@&${id}>`).join(' '),
    });
  for (let start = 0; start < settings.exemptChannels.length; start += 25)
    embed.addFields({
      name: start ? 'Exempt channels (continued)' : 'Exempt channels',
      value: settings.exemptChannels
        .slice(start, start + 25)
        .map((id) => `<#${id}>`)
        .join(' '),
    });
  return embed;
}
