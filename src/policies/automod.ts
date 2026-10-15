import { createHash } from 'node:crypto';
import { Client, PermissionFlagsBits as P, Routes } from 'discord.js';
import type { NativeCommands } from '../commands/router.js';
import { UserError, type GuildSettings, type Preset } from '../domain.js';
import type { Store } from '../storage/store.js';
export interface RuleSpec {
  name: string;
  event_type: number;
  trigger_type: number;
  enabled: boolean;
  trigger_metadata: Record<string, unknown>;
  actions: { type: number; metadata?: Record<string, unknown> }[];
  exempt_roles: string[];
  exempt_channels: string[];
}
export interface NativeRule extends RuleSpec {
  id: string;
  creator_id: string;
}
export interface NativePort {
  botId(): string;
  list(guildId: string): Promise<NativeRule[]>;
  create(guildId: string, spec: RuleSpec): Promise<NativeRule>;
  edit(guildId: string, id: string, spec: Partial<RuleSpec>): Promise<NativeRule>;
  checkLog(guildId: string, channelId: string): Promise<void>;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function normalizeRule(rule: RuleSpec) {
  const m = rule.trigger_metadata;
  return {
    name: rule.name,
    event_type: rule.event_type,
    trigger_type: rule.trigger_type,
    enabled: rule.enabled,
    trigger_metadata: {
      keyword_filter: m.keyword_filter ?? [],
      regex_patterns: m.regex_patterns ?? [],
      presets: m.presets ?? [],
      allow_list: m.allow_list ?? [],
      mention_total_limit: m.mention_total_limit ?? null,
      mention_raid_protection_enabled: m.mention_raid_protection_enabled ?? false,
    },
    actions: rule.actions
      .map((a) => ({ type: a.type, metadata: a.metadata ?? {} }))
      .sort((a, b) => a.type - b.type),
    exempt_roles: [...rule.exempt_roles].sort(),
    exempt_channels: [...rule.exempt_channels].sort(),
  };
}
function specFor(settings: GuildSettings, preset: Preset, enabled: boolean): RuleSpec {
  const config = settings.automod[preset];
  if (enabled && !settings.logChannelId) throw new UserError('Run /setup before applying a rule.');
  if (enabled && preset === 'keywords' && !config.keywords.length)
    throw new UserError('Configure at least one keyword first.');
  const metadata =
    preset === 'mentions'
      ? { mention_total_limit: config.mentionLimit }
      : preset === 'words'
        ? { presets: config.wordCategories }
        : { keyword_filter: config.keywords };
  return {
    name: `Moderation v3 ${preset} [${config.key}]`,
    event_type: 1,
    trigger_type: preset === 'mentions' ? 5 : preset === 'words' ? 4 : 1,
    enabled,
    trigger_metadata: metadata,
    actions: [
      { type: 1 },
      ...(settings.logChannelId
        ? [{ type: 2, metadata: { channel_id: settings.logChannelId } }]
        : []),
    ],
    exempt_roles: settings.exemptRoles,
    exempt_channels: settings.exemptChannels,
  };
}
export class AutoModManager implements NativeCommands {
  private active = new Set<string>();
  constructor(
    private readonly store: Store,
    private readonly port: NativePort,
  ) {}
  private owned(
    settings: GuildSettings,
    preset: Preset,
    rules: NativeRule[],
  ): NativeRule | undefined {
    const config = settings.automod[preset];
    const tracked = config.ruleId ? rules.find((r) => r.id === config.ruleId) : undefined;
    if (tracked && tracked.creator_id !== this.port.botId())
      throw new UserError(
        'The stored rule is not owned by this bot. Staff must review the configuration.',
      );
    if (tracked) return tracked;
    const matches = rules.filter(
      (r) =>
        r.creator_id === this.port.botId() && r.name === `Moderation v3 ${preset} [${config.key}]`,
    );
    if (matches.length > 1)
      throw new UserError('Several rules match this preset. Staff must review them in Discord.');
    return matches[0];
  }
  async status(guildId: string) {
    const settings = await this.store.getSettings(guildId);
    const rules = await this.port.list(guildId);
    return (['mentions', 'words', 'keywords'] as const)
      .map((preset) => {
        const rule = this.owned(settings, preset, rules);
        if (!rule)
          return `${preset}: ${settings.automod[preset].ruleId ? 'FAULT: owned rule missing' : 'not applied'}.`;
        const actual = hash(normalizeRule(rule));
        const drift = settings.automod[preset].lastApplied !== actual;
        return `${preset}: ${rule.enabled ? 'enabled' : 'disabled'}${drift ? '; external changes or recovered rule — review before applying' : ''}.`;
      })
      .join('\n');
  }
  async configure(
    guildId: string,
    preset: Preset,
    input: { limit: number | null; categories: string | null; keywords: string | null },
  ) {
    const settings = await this.store.getSettings(guildId);
    const config = settings.automod[preset];
    if (input.limit !== null) {
      if (
        preset !== 'mentions' ||
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 50
      )
        throw new UserError(
          'Mention limits must be whole numbers from 1 to 50, on the mentions preset.',
        );
      config.mentionLimit = input.limit;
    }
    if (input.categories !== null) {
      if (preset !== 'words') throw new UserError('Categories apply only to word filters.');
      const categories: Record<string, number> = { profanity: 1, sexual: 2, slurs: 3 };
      const entries = input.categories.split(',').map((v) => v.trim().toLowerCase());
      if (!entries.length || entries.some((v) => !Object.hasOwn(categories, v)))
        throw new UserError('Choose comma-separated categories: slurs, profanity, sexual.');
      config.wordCategories = [...new Set(entries.map((v) => categories[v]!))].sort();
    }
    if (input.keywords !== null) {
      if (preset !== 'keywords') throw new UserError('Keywords apply only to the keywords preset.');
      const entries = [
        ...new Set(
          input.keywords
            .split(/\r?\n/)
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      ];
      if (!entries.length || entries.length > 100 || entries.some((v) => v.length > 60))
        throw new UserError('Provide 1–100 keyword lines, each at most 60 characters.');
      config.keywords = entries;
    }
    await this.store.saveSettings(settings);
    return 'Preset configuration saved. Use /automod apply to preview and enable it.';
  }
  private async snapshot(guildId: string, preset: Preset, enabled: boolean) {
    const settings = await this.store.getSettings(guildId);
    const rules = await this.port.list(guildId);
    const owned = this.owned(settings, preset, rules);
    const spec = specFor(settings, preset, enabled);
    if (enabled) {
      await this.port.checkLog(guildId, settings.logChannelId!);
      const limit = spec.trigger_type === 1 ? 6 : 1;
      if (!owned && rules.filter((r) => r.trigger_type === spec.trigger_type).length >= limit)
        throw new UserError(
          'Discord has no free slot for this rule type. Existing rules were not changed.',
        );
    }
    const fingerprint = hash({
      version: settings.version,
      spec: normalizeRule(spec),
      rules: rules
        .map((r) => ({ id: r.id, creator: r.creator_id, spec: normalizeRule(r) }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
    return { settings, owned, spec, fingerprint };
  }
  async preview(guildId: string, preset: Preset, enabled: boolean) {
    const snapshot = await this.snapshot(guildId, preset, enabled);
    const changed =
      snapshot.owned &&
      snapshot.settings.automod[preset].lastApplied !== hash(normalizeRule(snapshot.owned));
    return {
      fingerprint: snapshot.fingerprint,
      text: `${enabled ? 'Apply' : 'Disable'} ${preset}.\nOwned rule: ${snapshot.owned?.id ?? 'none'}.\n${enabled ? `Actions: block and alert channel ${snapshot.settings.logChannelId}.\nConfiguration: ${JSON.stringify(snapshot.spec.trigger_metadata).slice(0, 1000)}\nExempt roles: ${snapshot.spec.exempt_roles.length}; channels: ${snapshot.spec.exempt_channels.length}.` : 'Other rules will not be changed.'}${changed ? '\nExternal changes detected. Confirming will replace the managed configuration.' : ''}\nConfirm within 60 seconds.`,
    };
  }
  async apply(guildId: string, preset: Preset, enabled: boolean, fingerprint: string) {
    if (this.active.has(guildId))
      throw new UserError('Another rule operation is running. Try again.');
    this.active.add(guildId);
    try {
      const snapshot = await this.snapshot(guildId, preset, enabled);
      if (snapshot.fingerprint !== fingerprint)
        throw new UserError('Rules or settings changed after the preview. Run the command again.');
      const rule = enabled
        ? snapshot.owned
          ? await this.port.edit(guildId, snapshot.owned.id, snapshot.spec)
          : await this.port.create(guildId, snapshot.spec)
        : snapshot.owned
          ? await this.port.edit(guildId, snapshot.owned.id, { enabled: false })
          : undefined;
      const config = snapshot.settings.automod[preset];
      config.enabled = enabled;
      config.ruleId = rule?.id ?? null;
      config.lastApplied = rule ? hash(normalizeRule(rule)) : null;
      await this.store.saveSettings(snapshot.settings);
      return `${preset} ${enabled ? 'enabled' : 'disabled'}. Other rules were not changed.`;
    } finally {
      this.active.delete(guildId);
    }
  }
}
export class DiscordNativePort implements NativePort {
  constructor(private readonly client: Client) {}
  botId() {
    if (!this.client.user) throw new UserError('Discord is not ready.');
    return this.client.user.id;
  }
  async list(guildId: string) {
    const guild = await this.client.guilds.fetch(guildId);
    if (!(await guild.members.fetchMe({ force: true })).permissions.has(P.ManageGuild))
      throw new UserError('The bot needs Manage Server to manage native AutoMod.');
    return (await this.client.rest.get(Routes.guildAutoModerationRules(guildId))) as NativeRule[];
  }
  async create(guildId: string, spec: RuleSpec) {
    return (await this.client.rest.post(Routes.guildAutoModerationRules(guildId), {
      body: spec,
      reason: 'Apply owned moderation preset.',
    })) as NativeRule;
  }
  async edit(guildId: string, id: string, spec: Partial<RuleSpec>) {
    return (await this.client.rest.patch(Routes.guildAutoModerationRule(guildId, id), {
      body: spec,
      reason: 'Update owned moderation preset.',
    })) as NativeRule;
  }
  async checkLog(guildId: string, channelId: string) {
    const guild = await this.client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    const me = await guild.members.fetchMe();
    if (!channel?.isSendable() || !channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages]))
      throw new UserError('The bot cannot send alerts to the configured staff channel.');
  }
}
