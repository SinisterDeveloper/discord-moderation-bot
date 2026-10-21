import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits as P,
  SlashCommandBuilder,
  ChannelType,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';
const base = (name: string, description: string, permission?: bigint) => {
  const command = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall);
  if (permission) command.setDefaultMemberPermissions(permission);
  return command;
};
const contextMenu = (
  name: string,
  type: ApplicationCommandType.User | ApplicationCommandType.Message,
  permission?: bigint,
) => {
  const command = new ContextMenuCommandBuilder()
    .setName(name)
    .setType(type)
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall);
  if (permission) command.setDefaultMemberPermissions(permission);
  return command;
};
const reason = (command: SlashCommandSubcommandBuilder) =>
  command.addStringOption((o) =>
    o
      .setName('reason')
      .setDescription('Reason for this action.')
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(400),
  );
const id = (command: SlashCommandSubcommandBuilder) =>
  command.addStringOption((o) =>
    o
      .setName('id')
      .setDescription('Case #number (e.g. #1) or 24-character Case ID.')
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(32)
      .setAutocomplete(true),
  );
const presets = [
  { name: 'Mention spam', value: 'mentions' },
  { name: 'Discord word filters', value: 'words' },
  { name: 'Keywords', value: 'keywords' },
];
const preset = (c: SlashCommandSubcommandBuilder) =>
  c.addStringOption((o) =>
    o
      .setName('preset')
      .setDescription('Managed preset.')
      .setChoices(...presets)
      .setRequired(true),
  );
const commands = [
  base('ping', 'Check the bot connection.'),
  base('help', 'Show commands and setup guidance.'),
  base('doctor', 'Check permissions, policies, and unresolved cases.', P.ManageGuild),
  base(
    'panel',
    'Open the interactive server configuration and policy control center.',
    P.ManageGuild,
  ),
  base('setup', 'Set the staff log channel.', P.ManageGuild).addChannelOption((o) =>
    o
      .setName('log-channel')
      .setDescription('Private staff log channel.')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  ),
  ...(
    [
      'ban',
      'tempban',
      'softban',
      'kick',
      'warn',
      'note',
      'timeout',
      'untimeout',
      'legacy-unmute',
      'unban',
    ] as const
  ).map((name) => {
    const c = base(
      name,
      name === 'note'
        ? 'Record a private staff note on a member.'
        : `${name} a member with an auditable reason.`,
      name === 'ban' || name === 'tempban' || name === 'softban' || name === 'unban'
        ? P.BanMembers
        : name === 'kick'
          ? P.KickMembers
          : P.ModerateMembers,
    );
    if (name === 'ban' || name === 'tempban' || name === 'unban')
      c.addStringOption((o) =>
        o
          .setName(name === 'unban' ? 'user-id' : 'target')
          .setDescription('User ID or mention.')
          .setRequired(true)
          .setMaxLength(24),
      );
    else
      c.addUserOption((o) => o.setName('user').setDescription('Target member.').setRequired(true));
    if (name === 'timeout' || name === 'tempban')
      c.addStringOption((o) =>
        o
          .setName('duration')
          .setDescription(
            name === 'timeout'
              ? 'For example: 30m, 12h, 7d. Maximum 28d.'
              : 'For example: 24h, 7d, 30d. Maximum 365d.',
          )
          .setRequired(true)
          .setMaxLength(12),
      );
    c.addStringOption((o) =>
      o
        .setName('reason')
        .setDescription('Reason for this action.')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(400),
    );
    if (name === 'ban' || name === 'tempban' || name === 'softban')
      c.addIntegerOption((o) =>
        o
          .setName('delete-days')
          .setDescription('Days of recent messages to delete (0–7).')
          .setMinValue(name === 'softban' ? 1 : 0)
          .setMaxValue(7),
      );
    return c;
  }),
  base(
    'whois',
    'Inspect a user profile, roles, permissions, and moderation summary.',
    P.ModerateMembers,
  ).addUserOption((o) => o.setName('user').setDescription('User to inspect.').setRequired(true)),
  base('purge', 'Bulk delete messages in this channel with filters.', P.ManageMessages)
    .addIntegerOption((o) =>
      o
        .setName('count')
        .setDescription('Number of recent messages to scan (1–100).')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    )
    .addStringOption((o) =>
      o
        .setName('reason')
        .setDescription('Reason for purging messages.')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(400),
    )
    .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this user.'))
    .addStringOption((o) =>
      o
        .setName('contains')
        .setDescription('Only delete messages containing this substring.')
        .setMaxLength(100),
    )
    .addBooleanOption((o) => o.setName('bots-only').setDescription('Only delete bot messages.'))
    .addBooleanOption((o) =>
      o.setName('attachments-only').setDescription('Only delete messages with attachments.'),
    ),
  base('lock', 'Lock a text channel so regular members cannot send messages.', P.ManageChannels)
    .addStringOption((o) =>
      o
        .setName('reason')
        .setDescription('Reason for locking the channel.')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(400),
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel to lock (defaults to current channel).')
        .addChannelTypes(ChannelType.GuildText),
    )
    .addStringOption((o) =>
      o
        .setName('duration')
        .setDescription('Optional duration before auto-unlock (e.g. 30m, 2h, 1d).')
        .setMaxLength(12),
    ),
  base('unlock', 'Unlock a locked text channel.', P.ManageChannels)
    .addStringOption((o) =>
      o
        .setName('reason')
        .setDescription('Reason for unlocking the channel.')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(400),
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel to unlock (defaults to current channel).')
        .addChannelTypes(ChannelType.GuildText),
    ),
  base('slowmode', 'Set the slowmode rate limit for a text channel.', P.ManageChannels)
    .addIntegerOption((o) =>
      o
        .setName('seconds')
        .setDescription('Rate limit in seconds (0 to disable, max 21600).')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600),
    )
    .addStringOption((o) =>
      o
        .setName('reason')
        .setDescription('Reason for changing slowmode.')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(400),
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Target channel (defaults to current channel).')
        .addChannelTypes(ChannelType.GuildText),
    ),
  base('cases', 'Read a user’s case history.', P.ModerateMembers).addUserOption((o) =>
    o.setName('user').setDescription('User to check.').setRequired(true),
  ),
  base('case', 'Read or amend a moderation case.')
    .addSubcommand((s) => id(s.setName('view').setDescription('Read a case.')))
    .addSubcommand((s) =>
      reason(id(s.setName('reason').setDescription('Amend the reason. Requires Manage Server.'))),
    )
    .addSubcommand((s) =>
      reason(id(s.setName('revoke').setDescription('Revoke a warning. Requires Manage Server.'))),
    )
    .addSubcommand((s) =>
      id(
        s.setName('resolve').setDescription('Resolve an uncertain action. Requires Manage Server.'),
      )
        .addStringOption((o) =>
          o
            .setName('outcome')
            .setDescription('Verified outcome.')
            .setChoices(
              { name: 'Succeeded', value: 'succeeded' },
              { name: 'Failed', value: 'failed' },
            )
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('evidence')
            .setDescription('How the result was verified.')
            .setMinLength(1)
            .setMaxLength(400)
            .setRequired(true),
        ),
    ),
  base('config', 'Manage server policy settings.', P.ManageGuild)
    .addSubcommand((s) => s.setName('view').setDescription('Show current settings.'))
    .addSubcommand((s) =>
      s
        .setName('account-age')
        .setDescription('Configure minimum account age.')
        .addBooleanOption((o) =>
          o.setName('enabled').setDescription('Enable the policy.').setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName('days')
            .setDescription('Minimum age in whole days.')
            .setMinValue(1)
            .setMaxValue(3650),
        )
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('Policy action.')
            .setChoices({ name: 'Alert', value: 'alert' }, { name: 'Kick', value: 'kick' }),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('invites')
        .setDescription('Allow only invites to this server.')
        .addBooleanOption((o) =>
          o.setName('enabled').setDescription('Enable invite filtering.').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('notifications')
        .setDescription('Configure action DMs.')
        .addBooleanOption((o) =>
          o.setName('dm').setDescription('Send action notifications by DM.').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('log-channel')
        .setDescription('Set a staff log channel.')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Staff channel.')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Log stream to route to this channel.')
            .setChoices(
              { name: 'Default / Moderation logs', value: 'modLog' },
              { name: 'Policy & AutoMod alerts', value: 'alertLog' },
              { name: 'Member appeals', value: 'appealLog' },
              { name: 'Member reports', value: 'reportLog' },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('exempt-role')
        .setDescription('Add or remove a policy role exemption.')
        .addStringOption((o) =>
          o
            .setName('operation')
            .setDescription('Change.')
            .setChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' })
            .setRequired(true),
        )
        .addRoleOption((o) => o.setName('role').setDescription('Exempt role.').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('exempt-channel')
        .setDescription('Add or remove a policy channel exemption.')
        .addStringOption((o) =>
          o
            .setName('operation')
            .setDescription('Change.')
            .setChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' })
            .setRequired(true),
        )
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Exempt channel.').setRequired(true),
        ),
    ),
  base('automod', 'Manage native Discord AutoMod presets.', P.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('Show owned rules and drift.'))
    .addSubcommand((s) =>
      preset(
        s.setName('configure').setDescription('Save preset configuration without applying it.'),
      )
        .addIntegerOption((o) =>
          o.setName('limit').setDescription('Mention limit.').setMinValue(1).setMaxValue(50),
        )
        .addStringOption((o) =>
          o
            .setName('categories')
            .setDescription('Comma-separated: slurs, profanity, sexual.')
            .setMaxLength(100),
        )
        .addStringOption((o) =>
          o
            .setName('keywords')
            .setDescription('One entry per line, at most 100.')
            .setMaxLength(6000),
        ),
    )
    .addSubcommand((s) =>
      preset(s.setName('apply').setDescription('Preview and enable a managed rule.')),
    )
    .addSubcommand((s) => preset(s.setName('disable').setDescription('Disable an owned rule.'))),
  contextMenu('Inspect & Moderate', ApplicationCommandType.User, P.ModerateMembers),
  contextMenu('Moderate Message', ApplicationCommandType.Message, P.ModerateMembers),
];
export const commandDefinitions = commands.map((command) => command.toJSON());
