import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits as P,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
  type AnySelectMenuInteraction,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type InteractionEditReplyOptions,
  type MessageContextMenuCommandInteraction,
  type ModalSubmitInteraction,
  type UserContextMenuCommandInteraction,
} from 'discord.js';
import { parseDuration, parseReason, snowflake, type Capabilities } from '../config.js';
import {
  UserError,
  type Action,
  type ActionRequest,
  type GuildSettings,
  type LogChannels,
  type Preset,
} from '../domain.js';
import {
  actionLabel,
  caseEmbed,
  caseRef,
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
type Interactive =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | AnySelectMenuInteraction
  | ModalSubmitInteraction
  | UserContextMenuCommandInteraction
  | MessageContextMenuCommandInteraction;
type Callback = (interaction: ButtonInteraction | AnySelectMenuInteraction) => Promise<Reply>;
type ModalFactory = (interaction: ButtonInteraction) => Promise<ModalBuilder>;
type ModalCallback = (interaction: ModalSubmitInteraction) => Promise<Reply>;
type PanelSection = 'overview' | 'exemptions' | 'policies' | 'automod';
export class CommandRouter {
  private sessions = new Sessions<Callback>();
  private modalTriggers = new Sessions<ModalFactory>();
  private modalSubmits = new Sessions<ModalCallback>();
  private lastUse = new Map<string, number>();
  constructor(
    private readonly client: Client,
    private readonly store: Store,
    private readonly service: ModerationService,
    private readonly capabilities: Capabilities,
    private readonly native?: NativeCommands,
  ) {}
  private async requirePermission(interaction: Interactive, permission: bigint) {
    if (!interaction.guildId) throw new UserError('Use this command in a server.');
    const guild = await this.client.guilds.fetch(interaction.guildId);
    const member = await guild.members.fetch({ user: interaction.user.id, force: true });
    if (member.id !== guild.ownerId && !member.permissions.has(permission))
      throw new UserError('You do not have permission for this command.');
  }
  private makeButton(
    interaction: Interactive,
    label: string,
    callback: Callback,
    danger = false,
    keep = false,
  ) {
    const id = this.sessions.create(interaction.user.id, interaction.guildId!, callback, keep);
    return new ButtonBuilder()
      .setCustomId(`v3:${id}`)
      .setLabel(label)
      .setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Primary);
  }
  private button(
    interaction: Interactive,
    label: string,
    callback: Callback,
    danger = false,
    keep = false,
  ) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      this.makeButton(interaction, label, callback, danger, keep),
    );
  }
  private makeModalButton(
    interaction: Interactive,
    label: string,
    title: string,
    fields: {
      id: string;
      label: string;
      style?: TextInputStyle;
      value?: string;
      placeholder?: string;
      required?: boolean;
      maxLength?: number;
    }[],
    onSubmit: ModalCallback,
    danger = false,
  ) {
    const triggerId = this.modalTriggers.create(
      interaction.user.id,
      interaction.guildId!,
      async (btn) => {
        const submitId = this.modalSubmits.create(btn.user.id, btn.guildId!, onSubmit);
        const modal = new ModalBuilder().setCustomId(`v3s:${submitId}`).setTitle(title);
        for (const f of fields) {
          const input = new TextInputBuilder()
            .setCustomId(f.id)
            .setLabel(f.label)
            .setStyle(f.style ?? TextInputStyle.Short)
            .setRequired(f.required ?? true)
            .setMaxLength(f.maxLength ?? 400);
          if (f.value) input.setValue(f.value);
          if (f.placeholder) input.setPlaceholder(f.placeholder);
          modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
        }
        return modal;
      },
      true,
    );
    return new ButtonBuilder()
      .setCustomId(`v3m:${triggerId}`)
      .setLabel(label)
      .setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Secondary);
  }
  private async handleAutocomplete(interaction: AutocompleteInteraction) {
    if (!interaction.guildId || !this.store.available()) {
      await interaction.respond([]).catch(() => {});
      return;
    }
    try {
      const focused = interaction.options.getFocused();
      const records = this.store.searchCases
        ? await this.store.searchCases(interaction.guildId, focused, 25)
        : [];
      await interaction.respond(
        records.slice(0, 25).map((r) => {
          const ref = r.caseNumber ? `#${r.caseNumber}` : r.id.slice(0, 8);
          const summary = `${ref} · ${actionLabel[r.action]} · ${r.targetId} — ${r.reason}`.slice(
            0,
            100,
          );
          return {
            name: summary,
            value: r.caseNumber ? String(r.caseNumber) : r.id,
          };
        }),
      );
    } catch {
      await interaction.respond([]).catch(() => {});
    }
  }
  async handle(interaction: Interaction) {
    if (interaction.isAutocomplete?.()) {
      await this.handleAutocomplete(interaction);
      return true;
    }
    const isCmd = interaction.isChatInputCommand?.() ?? false;
    const isBtn = interaction.isButton?.() ?? false;
    const isSelect = interaction.isAnySelectMenu?.() ?? false;
    const isModal = interaction.isModalSubmit?.() ?? false;
    const isUserCtx = interaction.isUserContextMenuCommand?.() ?? false;
    const isMsgCtx = interaction.isMessageContextMenuCommand?.() ?? false;
    if (!isCmd && !isBtn && !isSelect && !isModal && !isUserCtx && !isMsgCtx) return;
    const active = interaction as Interactive;
    if (!active.inGuild()) {
      if ('reply' in active)
        await active.reply({
          ...embedReply(textEmbed('Server command', 'Use this command in a server.', 'warning')),
          flags: MessageFlags.Ephemeral,
        });
      return;
    }
    try {
      if (isBtn) {
        const btn = interaction as ButtonInteraction;
        if (btn.customId.startsWith('v3m:')) {
          const buildModal = this.modalTriggers.take(
            btn.customId.slice(4),
            btn.user.id,
            btn.guildId!,
          );
          await btn.showModal(await buildModal(btn));
          return true;
        }
        if (!btn.customId.startsWith('v3:')) return;
        const callback = this.sessions.take(btn.customId.slice(3), btn.user.id, btn.guildId!);
        await btn.update(embedReply(textEmbed('Checking request', 'Please wait.')));
        await btn.editReply(await callback(btn));
      } else if (isSelect) {
        const sel = interaction as AnySelectMenuInteraction;
        if (!sel.customId.startsWith('v3:')) return;
        const callback = this.sessions.take(sel.customId.slice(3), sel.user.id, sel.guildId!);
        await sel.update(embedReply(textEmbed('Updating view', 'Please wait.')));
        await sel.editReply(await callback(sel));
      } else if (isModal) {
        const mod = interaction as ModalSubmitInteraction;
        if (!mod.customId.startsWith('v3s:')) return;
        const callback = this.modalSubmits.take(mod.customId.slice(4), mod.user.id, mod.guildId!);
        await mod.deferReply({ flags: MessageFlags.Ephemeral });
        await mod.editReply(await callback(mod));
      } else if (isUserCtx) {
        const ctx = interaction as UserContextMenuCommandInteraction;
        await ctx.deferReply({ flags: MessageFlags.Ephemeral });
        await ctx.editReply(await this.userContext(ctx));
      } else if (isMsgCtx) {
        const ctx = interaction as MessageContextMenuCommandInteraction;
        await ctx.deferReply({ flags: MessageFlags.Ephemeral });
        await ctx.editReply(await this.messageContext(ctx));
      } else {
        const chat = interaction as ChatInputCommandInteraction;
        await chat.deferReply({ flags: MessageFlags.Ephemeral });
        const key = `${chat.guildId}:${chat.user.id}:${chat.commandName}`;
        if ((this.lastUse.get(key) ?? 0) > Date.now())
          throw new UserError('Wait one second before repeating this command.');
        if (this.lastUse.size >= 5000) this.lastUse.delete(this.lastUse.keys().next().value!);
        this.lastUse.set(key, Date.now() + 1000);
        await chat.editReply(await this.chat(chat));
      }
      return true;
    } catch (error) {
      const ref = errorCode(error);
      logger.warn({ code: ref, guildId: active.guildId }, 'Command failed.');
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
      if (active.deferred || active.replied) await active.editReply(response).catch(() => {});
      else await active.reply({ ...response, flags: MessageFlags.Ephemeral }).catch(() => {});
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
    interaction: Interactive,
    target: string,
    cursor?: string,
    prevCursors: (string | undefined)[] = [],
    actionFilter = 'all',
  ): Promise<Reply> {
    await this.requirePermission(interaction, P.ModerateMembers);
    const page = await this.store.listCases(interaction.guildId!, target, cursor, {
      actionFilter,
    });
    const filterSelectId = this.sessions.create(
      interaction.user.id,
      interaction.guildId!,
      async (sel) => {
        const chosen = sel.isStringSelectMenu() ? (sel.values[0] ?? 'all') : 'all';
        return this.history(sel, target, undefined, [], chosen);
      },
      true,
    );
    const filterRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`v3:${filterSelectId}`)
        .setPlaceholder('Filter by action type')
        .addOptions(
          { label: 'All actions', value: 'all', default: actionFilter === 'all' },
          { label: 'Warnings', value: 'warn', default: actionFilter === 'warn' },
          { label: 'Timeouts & Mutes', value: 'timeout', default: actionFilter === 'timeout' },
          { label: 'Bans & Kicks', value: 'ban_kick', default: actionFilter === 'ban_kick' },
          { label: 'Staff Notes', value: 'note', default: actionFilter === 'note' },
        ),
    );
    if (!page.records.length)
      return {
        ...embedReply(
          textEmbed(
            'Case history',
            `No matching cases found for ${person(target)}${actionFilter !== 'all' ? ` (filter: ${actionFilter})` : ''}.`,
          ),
        ),
        components: actionFilter !== 'all' ? [filterRow] : [],
      };
    const embed = new EmbedBuilder()
      .setTitle('Case history')
      .setDescription(person(target))
      .setColor(0x5865f2)
      .addFields(
        page.records.map((record) => ({
          name: `${record.caseNumber ? `#${record.caseNumber} · ` : ''}${actionLabel[record.action]} · ${caseStatus(record)}`,
          value: `\`${record.id}\` · <t:${Math.floor(record.createdAt.getTime() / 1000)}:d>\n${escapeMarkdown(record.reason.slice(0, 100))}${record.reason.length > 100 ? '…' : ''}`,
        })),
      )
      .setFooter({
        text: `Page ${prevCursors.length + 1} · Newest first · Use /case view for details`,
      });
    const cursorNext = page.next;
    const navButtons: ButtonBuilder[] = [];
    if (prevCursors.length > 0) {
      const prevCursor = prevCursors[prevCursors.length - 1];
      const nextStack = prevCursors.slice(0, -1);
      navButtons.push(
        this.makeButton(
          interaction,
          'Previous page',
          (btn) => this.history(btn, target, prevCursor, nextStack, actionFilter),
          false,
          true,
        ),
      );
    }
    if (cursorNext) {
      navButtons.push(
        this.makeButton(
          interaction,
          'Next page',
          (btn) => this.history(btn, target, cursorNext, [...prevCursors, cursor], actionFilter),
          false,
          true,
        ),
      );
    }
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
    if (navButtons.length)
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...navButtons));
    components.push(filterRow);
    return {
      ...embedReply(embed),
      components,
    };
  }
  private async setLogChannel(
    settings: GuildSettings,
    channelId: string,
    kind: keyof LogChannels = 'modLog',
  ) {
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
    if (kind === 'modLog') {
      settings.logChannelId = channelId;
      if (settings.channels?.modLog !== undefined) {
        settings.channels = { ...settings.channels, modLog: channelId };
      }
    } else {
      settings.channels = { ...settings.channels, [kind]: channelId };
      if (!settings.logChannelId) settings.logChannelId = channelId;
    }
  }
  private async panel(
    interaction: Interactive,
    section: PanelSection = 'overview',
    notice?: string,
  ): Promise<Reply> {
    await this.requirePermission(interaction, P.ManageGuild);
    const guildId = interaction.guildId!;
    const settings = await this.store.getSettings(guildId);
    const navId = this.sessions.create(
      interaction.user.id,
      guildId,
      async (sel) => {
        const chosen = (sel.isStringSelectMenu() ? sel.values[0] : 'overview') as PanelSection;
        return this.panel(sel, chosen);
      },
      true,
    );
    const navRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`v3:${navId}`)
        .setPlaceholder('Choose control center section')
        .addOptions(
          {
            label: 'Overview & Log Channels',
            description: 'Staff log channels and DM notification settings',
            value: 'overview',
            default: section === 'overview',
          },
          {
            label: 'Role & Channel Exemptions',
            description: 'Multi-select roles and channels exempt from policies',
            value: 'exemptions',
            default: section === 'exemptions',
          },
          {
            label: 'Automated Policies',
            description: 'Account-age gate and external invite filter',
            value: 'policies',
            default: section === 'policies',
          },
          {
            label: 'Native AutoMod Presets',
            description: 'Configure and apply Discord AutoMod rules via Modals',
            value: 'automod',
            default: section === 'automod',
          },
        ),
    );
    if (section === 'overview') {
      const embed = settingsEmbed(settings).setTitle('Control Center · Overview & Channels');
      if (notice) embed.setAuthor({ name: notice });
      const channelSelectId = this.sessions.create(
        interaction.user.id,
        guildId,
        async (sel) => {
          await this.requirePermission(sel, P.ManageGuild);
          const chosen = sel.isChannelSelectMenu() ? sel.values[0] : undefined;
          if (!chosen) return this.panel(sel, 'overview');
          const current = await this.store.getSettings(guildId);
          await this.setLogChannel(current, chosen, 'modLog');
          await this.store.saveSettings(current);
          return this.panel(sel, 'overview', 'Staff log channel updated');
        },
        true,
      );
      const channelRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`v3:${channelSelectId}`)
          .setPlaceholder('Select primary staff log channel')
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1),
      );
      const dmButton = this.makeButton(
        interaction,
        settings.dmEnabled ? 'Disable Action DMs' : 'Enable Action DMs',
        async (btn) => {
          await this.requirePermission(btn, P.ManageGuild);
          const current = await this.store.getSettings(guildId);
          current.dmEnabled = !current.dmEnabled;
          await this.store.saveSettings(current);
          return this.panel(
            btn,
            'overview',
            `Action DMs ${current.dmEnabled ? 'enabled' : 'disabled'}`,
          );
        },
        settings.dmEnabled,
        true,
      );
      return {
        ...embedReply(embed),
        components: [
          navRow,
          channelRow,
          new ActionRowBuilder<ButtonBuilder>().addComponents(dmButton),
        ],
      };
    }
    if (section === 'exemptions') {
      const embed = settingsEmbed(settings).setTitle('Control Center · Policy Exemptions');
      if (notice) embed.setAuthor({ name: notice });
      const roleSelectId = this.sessions.create(
        interaction.user.id,
        guildId,
        async (sel) => {
          await this.requirePermission(sel, P.ManageGuild);
          const values = sel.isRoleSelectMenu() ? sel.values.filter((id) => id !== guildId) : [];
          const current = await this.store.getSettings(guildId);
          current.exemptRoles = [...new Set(values)].slice(0, 20);
          await this.store.saveSettings(current);
          return this.panel(sel, 'exemptions', 'Exempt roles updated');
        },
        true,
      );
      const chanSelectId = this.sessions.create(
        interaction.user.id,
        guildId,
        async (sel) => {
          await this.requirePermission(sel, P.ManageGuild);
          const values = sel.isChannelSelectMenu() ? sel.values : [];
          const current = await this.store.getSettings(guildId);
          current.exemptChannels = [...new Set(values)].slice(0, 25);
          await this.store.saveSettings(current);
          return this.panel(sel, 'exemptions', 'Exempt channels updated');
        },
        true,
      );
      const roleRow = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`v3:${roleSelectId}`)
          .setPlaceholder('Select exempt roles (replaces current list)')
          .setMinValues(0)
          .setMaxValues(20),
      );
      const chanRow = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`v3:${chanSelectId}`)
          .setPlaceholder('Select exempt channels (replaces current list)')
          .setMinValues(0)
          .setMaxValues(25),
      );
      return {
        ...embedReply(embed),
        components: [navRow, roleRow, chanRow],
      };
    }
    if (section === 'policies') {
      const age = settings.accountAge;
      const embed = textEmbed(
        'Control Center · Automated Policies',
        [
          `**Account-age gate** ${age.enabled ? `On (${age.days} days · ${age.action === 'kick' ? 'Kick' : 'Alert'})` : `Off (configured: ${age.days} days · ${age.action})`}`,
          `**External invite filter** ${settings.invites.enabled ? 'On' : 'Off'}`,
          `**Runtime capabilities** Member events: ${this.capabilities.memberEvents ? 'On' : 'Off'} · Message filter: ${this.capabilities.messageFilter ? 'On' : 'Off'}`,
        ].join('\n'),
      );
      if (notice) embed.setAuthor({ name: notice });
      const toggleAge = this.makeButton(
        interaction,
        age.enabled ? 'Disable Account Age' : 'Enable Account Age',
        async (btn) => {
          await this.requirePermission(btn, P.ManageGuild);
          const current = await this.store.getSettings(guildId);
          const nextEnabled = !current.accountAge.enabled;
          if (nextEnabled && !this.capabilities.memberEvents)
            throw new UserError(
              'Enable member events in runtime configuration and restart before enabling this policy.',
            );
          if (nextEnabled && !current.logChannelId)
            throw new UserError('Run /setup to choose a staff log channel first.');
          if (nextEnabled && current.accountAge.action === 'kick')
            await this.requirePermission(btn, P.KickMembers);
          current.accountAge.enabled = nextEnabled;
          await this.store.saveSettings(current);
          return this.panel(
            btn,
            'policies',
            `Account-age gate ${nextEnabled ? 'enabled' : 'disabled'}`,
          );
        },
        age.enabled,
        true,
      );
      const toggleMode = this.makeButton(
        interaction,
        `Mode: ${age.action === 'kick' ? 'Switch to Alert' : 'Switch to Kick'}`,
        async (btn) => {
          await this.requirePermission(btn, P.ManageGuild);
          const current = await this.store.getSettings(guildId);
          const nextAction = current.accountAge.action === 'kick' ? 'alert' : 'kick';
          if (nextAction === 'kick') await this.requirePermission(btn, P.KickMembers);
          current.accountAge.action = nextAction;
          await this.store.saveSettings(current);
          return this.panel(btn, 'policies', `Account-age action set to ${nextAction}`);
        },
        false,
        true,
      );
      const editDaysModal = this.makeModalButton(
        interaction,
        'Set Age Threshold (Days)',
        'Account-Age Threshold',
        [
          {
            id: 'days',
            label: 'Minimum account age in whole days (1–3650)',
            value: String(age.days),
            maxLength: 4,
          },
        ],
        async (mod) => {
          await this.requirePermission(mod, P.ManageGuild);
          const days = Number(mod.fields.getTextInputValue('days').trim());
          if (!Number.isInteger(days) || days < 1 || days > 3650)
            throw new UserError('Days must be a whole number from 1 to 3650.');
          const current = await this.store.getSettings(guildId);
          current.accountAge.days = days;
          await this.store.saveSettings(current);
          return this.panel(mod, 'policies', `Account-age threshold set to ${days} days`);
        },
      );
      const toggleInvites = this.makeButton(
        interaction,
        settings.invites.enabled ? 'Disable Invite Filter' : 'Enable Invite Filter',
        async (btn) => {
          await this.requirePermission(btn, P.ManageGuild);
          const current = await this.store.getSettings(guildId);
          const nextEnabled = !current.invites.enabled;
          if (nextEnabled && !this.capabilities.messageFilter)
            throw new UserError(
              'Enable message filtering in runtime configuration and restart before enabling this policy.',
            );
          if (nextEnabled && !current.logChannelId)
            throw new UserError('Run /setup to choose a staff log channel first.');
          current.invites.enabled = nextEnabled;
          await this.store.saveSettings(current);
          return this.panel(
            btn,
            'policies',
            `Invite filter ${nextEnabled ? 'enabled' : 'disabled'}`,
          );
        },
        settings.invites.enabled,
        true,
      );
      return {
        ...embedReply(embed),
        components: [
          navRow,
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            toggleAge,
            toggleMode,
            editDaysModal,
            toggleInvites,
          ),
        ],
      };
    }
    const statusText = this.native
      ? await this.native
          .status(guildId)
          .catch(() => 'AutoMod status unavailable (check Manage Server permission).')
      : 'Native AutoMod is not available in this build.';
    const embed = textEmbed(
      'Control Center · Native AutoMod Presets',
      [
        statusText,
        '',
        `**Mentions draft** Limit: ${settings.automod.mentions.mentionLimit}`,
        `**Words draft** Categories: ${settings.automod.words.wordCategories.join(', ')}`,
        `**Keywords draft** ${settings.automod.keywords.keywords.length} keywords configured`,
      ].join('\n'),
    );
    if (notice) embed.setAuthor({ name: notice });
    const editKeywordsBtn = this.makeModalButton(
      interaction,
      'Edit Keywords (Modal)',
      'Configure AutoMod Keywords',
      [
        {
          id: 'keywords',
          label: 'One keyword or phrase per line (max 100)',
          style: TextInputStyle.Paragraph,
          value: settings.automod.keywords.keywords.join('\n').slice(0, 4000),
          placeholder: 'scam-domain.example\nfree nitro',
          maxLength: 4000,
        },
      ],
      async (mod) => {
        await this.requirePermission(mod, P.ManageGuild);
        if (!this.native) throw new UserError('Native AutoMod is not available in this build.');
        await this.native.configure(guildId, 'keywords', {
          keywords: mod.fields.getTextInputValue('keywords'),
          categories: null,
          limit: null,
        });
        return this.panel(mod, 'automod', 'Keywords preset draft saved');
      },
    );
    const editMentionsBtn = this.makeModalButton(
      interaction,
      'Edit Mention Limit (Modal)',
      'Configure Mention Spam Limit',
      [
        {
          id: 'limit',
          label: 'Mention limit per message (1–50)',
          value: String(settings.automod.mentions.mentionLimit),
          maxLength: 2,
        },
      ],
      async (mod) => {
        await this.requirePermission(mod, P.ManageGuild);
        if (!this.native) throw new UserError('Native AutoMod is not available in this build.');
        const limit = Number(mod.fields.getTextInputValue('limit').trim());
        await this.native.configure(guildId, 'mentions', {
          limit,
          categories: null,
          keywords: null,
        });
        return this.panel(mod, 'automod', 'Mention limit draft saved');
      },
    );
    const editWordsBtn = this.makeModalButton(
      interaction,
      'Edit Word Categories (Modal)',
      'Configure Discord Word Filters',
      [
        {
          id: 'categories',
          label: 'Categories (slurs, profanity, sexual)',
          value: settings.automod.words.wordCategories
            .map((c) => (c === 1 ? 'profanity' : c === 2 ? 'sexual' : 'slurs'))
            .join(', '),
          maxLength: 60,
        },
      ],
      async (mod) => {
        await this.requirePermission(mod, P.ManageGuild);
        if (!this.native) throw new UserError('Native AutoMod is not available in this build.');
        await this.native.configure(guildId, 'words', {
          limit: null,
          categories: mod.fields.getTextInputValue('categories'),
          keywords: null,
        });
        return this.panel(mod, 'automod', 'Word categories draft saved');
      },
    );
    return {
      ...embedReply(embed),
      components: [
        navRow,
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          editKeywordsBtn,
          editMentionsBtn,
          editWordsBtn,
        ),
      ],
    };
  }
  private async userContext(interaction: UserContextMenuCommandInteraction): Promise<Reply> {
    await this.requirePermission(interaction, P.ModerateMembers);
    const guildId = interaction.guildId!;
    const targetId = interaction.targetUser.id;
    const page = await this.store.listCases(guildId, targetId);
    const createdSec = Math.floor(interaction.targetUser.createdTimestamp / 1000);
    const embed = textEmbed(
      'Member Inspection & Quick Moderation',
      [
        `**Member** ${person(targetId)} (\`${targetId}\`)`,
        `**Account created** <t:${createdSec}:D> (<t:${createdSec}:R>)`,
        `**Recent cases** ${page.records.length ? `${page.records.length}${page.next ? '+' : ''} on record` : 'None'}`,
        ...page.records
          .slice(0, 3)
          .map(
            (r) =>
              `• ${r.caseNumber ? `#${r.caseNumber}` : `\`${r.id.slice(0, 8)}\``} **${actionLabel[r.action]}** (${caseStatus(r)}): ${escapeMarkdown(r.reason.slice(0, 60))}`,
          ),
      ].join('\n'),
    );
    const warnBtn = this.makeModalButton(
      interaction,
      'Warn',
      `Warn ${interaction.targetUser.username}`.slice(0, 45),
      [{ id: 'reason', label: 'Reason for warning', maxLength: 400 }],
      async (mod) =>
        this.actionResult({
          guildId,
          targetId,
          actorId: mod.user.id,
          source: 'manual',
          requestKey: mod.id,
          action: 'warn',
          reason: parseReason(mod.fields.getTextInputValue('reason')),
        }),
    );
    const timeoutBtn = this.makeModalButton(
      interaction,
      'Timeout',
      `Timeout ${interaction.targetUser.username}`.slice(0, 45),
      [
        {
          id: 'duration',
          label: 'Duration (e.g. 30m, 12h, 7d)',
          value: '1h',
          maxLength: 12,
        },
        { id: 'reason', label: 'Reason for timeout', maxLength: 400 },
      ],
      async (mod) =>
        this.actionResult({
          guildId,
          targetId,
          actorId: mod.user.id,
          source: 'manual',
          requestKey: mod.id,
          action: 'timeout',
          durationMs: parseDuration(mod.fields.getTextInputValue('duration').trim()),
          reason: parseReason(mod.fields.getTextInputValue('reason')),
        }),
    );
    const kickBtn = this.makeModalButton(
      interaction,
      'Kick',
      `Kick ${interaction.targetUser.username}`.slice(0, 45),
      [{ id: 'reason', label: 'Reason for kick', maxLength: 400 }],
      async (mod) =>
        this.actionResult({
          guildId,
          targetId,
          actorId: mod.user.id,
          source: 'manual',
          requestKey: mod.id,
          action: 'kick',
          reason: parseReason(mod.fields.getTextInputValue('reason')),
        }),
      true,
    );
    const banBtn = this.makeModalButton(
      interaction,
      'Ban',
      `Ban ${interaction.targetUser.username}`.slice(0, 45),
      [{ id: 'reason', label: 'Reason for ban', maxLength: 400 }],
      async (mod) =>
        this.actionResult({
          guildId,
          targetId,
          actorId: mod.user.id,
          source: 'manual',
          requestKey: mod.id,
          action: 'ban',
          reason: parseReason(mod.fields.getTextInputValue('reason')),
        }),
      true,
    );
    const historyBtn = this.makeButton(
      interaction,
      'View Cases',
      (btn) => this.history(btn, targetId),
      false,
      true,
    );
    return {
      ...embedReply(embed),
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          warnBtn,
          timeoutBtn,
          kickBtn,
          banBtn,
          historyBtn,
        ),
      ],
    };
  }
  private async messageContext(interaction: MessageContextMenuCommandInteraction): Promise<Reply> {
    await this.requirePermission(interaction, P.ModerateMembers);
    const guildId = interaction.guildId!;
    const msg = interaction.targetMessage;
    const targetId = msg.author.id;
    const snippet = msg.content ? escapeMarkdown(msg.content.slice(0, 300)) : '*No text content*';
    const embed = textEmbed(
      'Moderate Message',
      [
        `**Author** ${person(targetId)} (\`${targetId}\`)`,
        `**Channel** <#${interaction.channelId}> · **Message** \`${msg.id}\``,
        `**Content preview**\n> ${snippet.replace(/\n/g, '\n> ')}`,
      ].join('\n'),
      'warning',
    );
    const deleteMessageIfPossible = async () => {
      try {
        const guild = await this.client.guilds.fetch(guildId);
        const channel = await guild.channels.fetch(interaction.channelId);
        if (channel?.isTextBased()) {
          const fetched = await channel.messages.fetch(msg.id);
          await fetched.delete();
        }
      } catch {
        // Ignore if message was already deleted or bot lacks ManageMessages
      }
    };
    const deleteAndWarn = this.makeModalButton(
      interaction,
      'Delete & Warn',
      'Delete Message & Warn Author',
      [
        {
          id: 'reason',
          label: 'Reason for warning',
          value: `Message in <#${interaction.channelId}>: ${msg.content.slice(0, 120)}`.slice(
            0,
            400,
          ),
          maxLength: 400,
        },
      ],
      async (mod) => {
        await deleteMessageIfPossible();
        return this.actionResult({
          guildId,
          targetId,
          actorId: mod.user.id,
          source: 'manual',
          requestKey: mod.id,
          action: 'warn',
          channelId: interaction.channelId,
          messageId: msg.id,
          reason: parseReason(mod.fields.getTextInputValue('reason')),
        });
      },
    );
    const deleteAndTimeout = this.makeModalButton(
      interaction,
      'Delete & Timeout',
      'Delete Message & Timeout Author',
      [
        { id: 'duration', label: 'Duration (e.g. 30m, 12h, 7d)', value: '1h', maxLength: 12 },
        {
          id: 'reason',
          label: 'Reason for timeout',
          value: `Message in <#${interaction.channelId}>: ${msg.content.slice(0, 120)}`.slice(
            0,
            400,
          ),
          maxLength: 400,
        },
      ],
      async (mod) => {
        await deleteMessageIfPossible();
        return this.actionResult({
          guildId,
          targetId,
          actorId: mod.user.id,
          source: 'manual',
          requestKey: mod.id,
          action: 'timeout',
          channelId: interaction.channelId,
          messageId: msg.id,
          durationMs: parseDuration(mod.fields.getTextInputValue('duration').trim()),
          reason: parseReason(mod.fields.getTextInputValue('reason')),
        });
      },
      true,
    );
    const deleteAndBan = this.makeModalButton(
      interaction,
      'Delete & Ban',
      'Delete Message & Ban Author',
      [
        {
          id: 'reason',
          label: 'Reason for ban',
          value: `Message in <#${interaction.channelId}>: ${msg.content.slice(0, 120)}`.slice(
            0,
            400,
          ),
          maxLength: 400,
        },
      ],
      async (mod) => {
        await deleteMessageIfPossible();
        return this.actionResult({
          guildId,
          targetId,
          actorId: mod.user.id,
          source: 'manual',
          requestKey: mod.id,
          action: 'ban',
          channelId: interaction.channelId,
          messageId: msg.id,
          reason: parseReason(mod.fields.getTextInputValue('reason')),
        });
      },
      true,
    );
    return {
      ...embedReply(embed),
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          deleteAndWarn,
          deleteAndTimeout,
          deleteAndBan,
        ),
      ],
    };
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
      case 'log-channel': {
        const logKind = (o.getString?.('type') ?? 'modLog') as keyof LogChannels;
        await this.setLogChannel(settings, o.getChannel('channel', true).id, logKind);
        break;
      }
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
              name: 'Member Moderation',
              value:
                '`/ban` `/tempban` `/softban` `/unban` `/kick` `/warn` `/note` `/timeout` `/untimeout` `/legacy-unmute` `/whois`\nApps menu: `Inspect & Moderate` · `Moderate Message`',
            },
            {
              name: 'Channel Control & Cases',
              value:
                '`/purge` `/lock` `/unlock` `/slowmode`\n`/cases` `/case view` `/case reason` `/case revoke` `/case resolve`',
            },
            {
              name: 'Server setup & control center',
              value: '`/panel` `/setup` `/config` `/automod` `/doctor`',
            },
          )
          .setFooter({ text: 'Replies are private · Timeouts last at most 28 days' }),
      );
    if (name === 'panel') return this.panel(interaction);
    if (name === 'whois') {
      await this.requirePermission(interaction, P.ModerateMembers);
      const user = o.getUser('user', true);
      const page = await this.store.listCases(guildId, user.id);
      let memberInfo = '*Not currently in server*';
      try {
        const guild = await this.client.guilds.fetch(guildId);
        const member = await guild.members.fetch({ user: user.id, force: true });
        const joinedSec = member.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;
        const roles = [...member.roles.cache.values()]
          .filter((r) => r.id !== guildId)
          .slice(0, 15)
          .map((r) => `<@&${r.id}>`);
        const timedOut = member.isCommunicationDisabled?.()
          ? `\n**Timed out until** <t:${Math.floor(member.communicationDisabledUntilTimestamp! / 1000)}:f>`
          : '';
        memberInfo =
          [
            `**Joined server** ${joinedSec ? `<t:${joinedSec}:D> (<t:${joinedSec}:R>)` : 'Unknown'}`,
            `**Roles (${roles.length})** ${roles.length ? roles.join(' ') : 'None'}`,
          ].join('\n') + timedOut;
      } catch {
        // Member not in guild or fetch unavailable
      }
      const createdSec = user.createdTimestamp ? Math.floor(user.createdTimestamp / 1000) : 0;
      const embed = textEmbed(
        'Member Dossier',
        [
          `**User** ${person(user.id)} (\`${user.id}\`)`,
          ...(createdSec ? [`**Account created** <t:${createdSec}:D> (<t:${createdSec}:R>)`] : []),
          memberInfo,
          `**Recorded cases** ${page.records.length}${page.next ? '+' : ''}`,
          ...page.records
            .slice(0, 5)
            .map(
              (r) =>
                `• ${r.caseNumber ? `#${r.caseNumber}` : `\`${r.id.slice(0, 8)}\``} **${actionLabel[r.action]}** (${caseStatus(r)}) — ${escapeMarkdown(r.reason.slice(0, 60))}`,
            ),
        ].join('\n'),
      );
      const noteBtn = this.makeModalButton(
        interaction,
        'Add Staff Note',
        `Note for ${user.username}`.slice(0, 45),
        [
          {
            id: 'reason',
            label: 'Staff note (private)',
            style: TextInputStyle.Paragraph,
            maxLength: 400,
          },
        ],
        async (mod) =>
          this.actionResult({
            guildId,
            targetId: user.id,
            actorId: mod.user.id,
            source: 'manual',
            requestKey: mod.id,
            action: 'note',
            reason: parseReason(mod.fields.getTextInputValue('reason')),
          }),
      );
      const casesBtn = this.makeButton(
        interaction,
        'Full Case History',
        (btn) => this.history(btn, user.id),
        false,
        true,
      );
      return {
        ...embedReply(embed),
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(noteBtn, casesBtn)],
      };
    }
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
      if (sub === 'view') {
        const caseActions: ButtonBuilder[] = [
          this.makeModalButton(
            interaction,
            'Amend Reason',
            `Amend Case ${caseRef(record)}`.slice(0, 45),
            [
              {
                id: 'reason',
                label: 'Updated reason',
                style: TextInputStyle.Paragraph,
                value: record.reason,
                maxLength: 400,
              },
            ],
            async (mod) => {
              await this.requirePermission(mod, P.ManageGuild);
              const updated = await this.store.changeCase(guildId, record.id, {
                actorId: mod.user.id,
                at: new Date(),
                kind: 'reason',
                value: parseReason(mod.fields.getTextInputValue('reason')),
                previous: record.reason,
              });
              return embedReply(caseEmbed(updated, true).setAuthor({ name: 'Reason updated' }));
            },
          ),
        ];
        if (
          record.action === 'warn' &&
          !record.revoked &&
          ['succeeded', 'legacy_unverified'].includes(record.state)
        ) {
          caseActions.push(
            this.makeModalButton(
              interaction,
              'Revoke Warning',
              `Revoke Warning ${caseRef(record)}`.slice(0, 45),
              [
                {
                  id: 'reason',
                  label: 'Reason for revoking warning',
                  maxLength: 400,
                },
              ],
              async (mod) => {
                await this.requirePermission(mod, P.ManageGuild);
                const updated = await this.store.changeCase(guildId, record.id, {
                  actorId: mod.user.id,
                  at: new Date(),
                  kind: 'revoke',
                  value: parseReason(mod.fields.getTextInputValue('reason')),
                  previous: record.state,
                });
                return embedReply(caseEmbed(updated, true).setAuthor({ name: 'Warning revoked' }));
              },
              true,
            ),
          );
        }
        return {
          ...embedReply(caseEmbed(record, true)),
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...caseActions)],
        };
      }
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
    if (name === 'purge' || name === 'lock' || name === 'unlock' || name === 'slowmode') {
      const channelId = o.getChannel?.('channel')?.id ?? interaction.channelId;
      const filterUser = o.getUser?.('user')?.id;
      const request: ActionRequest = {
        guildId,
        targetId: filterUser ?? interaction.user.id,
        actorId: interaction.user.id,
        source: 'manual',
        requestKey: interaction.id,
        action: name,
        channelId,
        reason: parseReason(o.getString('reason', true)),
      };
      if (name === 'purge') {
        const count = o.getInteger('count', true);
        const contains = o.getString?.('contains') ?? undefined;
        const botsOnly = o.getBoolean?.('bots-only') ?? undefined;
        const attachmentsOnly = o.getBoolean?.('attachments-only') ?? undefined;
        request.purgeFilter = {
          count,
          ...(filterUser ? { targetId: filterUser } : {}),
          ...(contains ? { contains } : {}),
          ...(botsOnly ? { botsOnly } : {}),
          ...(attachmentsOnly ? { attachmentsOnly } : {}),
        };
      }
      if (name === 'lock') {
        const dur = o.getString?.('duration');
        if (dur) request.durationMs = parseDuration(dur, 365);
      }
      if (name === 'slowmode') {
        request.slowmodeSeconds = o.getInteger('seconds', true);
      }
      return this.actionResult(request);
    }
    const action = name.replace('-', '_') as Action;
    if (
      ![
        'ban',
        'tempban',
        'softban',
        'unban',
        'kick',
        'warn',
        'note',
        'timeout',
        'untimeout',
        'legacy_unmute',
      ].includes(action)
    )
      throw new UserError('Unknown command. Redeploy the current command definitions.');
    const target =
      action === 'ban' || action === 'tempban' || action === 'unban'
        ? o.getString(action === 'unban' ? 'user-id' : 'target', true).replace(/^<@!?(\d+)>$/, '$1')
        : o.getUser('user', true).id;
    if (!snowflake.safeParse(target).success)
      throw new UserError('Use a valid user ID or mention.');
    const deleteDays =
      action === 'ban' || action === 'tempban' || action === 'softban'
        ? (o.getInteger?.('delete-days') ?? null)
        : null;
    const request: ActionRequest = {
      guildId,
      targetId: target,
      actorId: interaction.user.id,
      source: 'manual',
      requestKey: interaction.id,
      action,
      reason: parseReason(o.getString('reason', true)),
      ...(deleteDays !== null ? { deleteMessageSeconds: deleteDays * 86_400 } : {}),
    };
    if (action === 'timeout') request.durationMs = parseDuration(o.getString('duration', true), 28);
    if (action === 'tempban')
      request.durationMs = parseDuration(o.getString('duration', true), 365);
    if (action === 'ban' || action === 'tempban' || action === 'softban' || action === 'kick') {
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
