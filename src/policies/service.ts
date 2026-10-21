import { PermissionFlagsBits as P } from 'discord.js';
import type { ModerationService } from '../moderation/service.js';
import type { Store } from '../storage/store.js';
import { logger } from '../logger.js';
interface Subject {
  guildId: string;
  userId: string;
  bot: boolean;
  permissions: bigint;
  roles: string[];
}
export interface JoinEvent extends Subject {
  createdAt: number;
  joinedAt: string;
}
export interface MessageEvent extends Subject {
  channelId: string;
  messageId: string;
  content: string;
}
export interface AutoModEvent {
  guildId: string;
  userId: string;
  ruleId: string;
  actionType: number;
  channelId?: string | undefined;
  messageId?: string | undefined;
  matchedKeyword?: string | null | undefined;
}
export function inviteCodes(content: string): string[] {
  const pattern =
    /(?<![\w.-])(?:https?:\/\/)?(?:www\.)?(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)([a-zA-Z0-9_-]{1,128})/gi;
  return [...new Set([...content.matchAll(pattern)].map((match) => match[1]!))];
}
export class InviteResolver {
  private cache = new Map<string, { guildId: string | null; expires: number }>();
  private pending = new Map<string, Promise<string | null>>();
  constructor(private readonly fetchInvite: (code: string) => Promise<string | null>) {}
  async resolve(code: string): Promise<string | null> {
    const cached = this.cache.get(code);
    if (cached && cached.expires > Date.now()) return cached.guildId;
    const pending = this.pending.get(code);
    if (pending) return pending;
    if (this.pending.size >= 4) throw new Error('Invite lookup capacity reached.');
    const work = this.fetchInvite(code)
      .then((guildId) => {
        this.cache.delete(code);
        if (this.cache.size >= 1000) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(code, { guildId, expires: Date.now() + 300_000 });
        return guildId;
      })
      .finally(() => this.pending.delete(code));
    this.pending.set(code, work);
    return work;
  }
}
export class PolicyService {
  private alerts = new Map<string, number>();
  private joinWindows = new Map<string, number[]>();
  constructor(
    private readonly store: Store,
    private readonly moderation: ModerationService,
    private readonly resolver: InviteResolver,
    private readonly botId: () => string,
    private readonly alert: (guildId: string, text: string) => Promise<void>,
  ) {}
  private async notify(guildId: string, code: string, text: string) {
    const key = `${guildId}:${code}`;
    if ((this.alerts.get(key) ?? 0) > Date.now()) return;
    if (this.alerts.size >= 1000) this.alerts.delete(this.alerts.keys().next().value!);
    this.alerts.set(key, Date.now() + 60_000);
    try {
      await this.alert(guildId, text);
    } catch {
      logger.warn({ guildId, code }, 'Policy alert could not be delivered.');
    }
  }
  private exempt(event: Subject, roles: string[]) {
    return (
      event.bot ||
      (event.permissions & P.Administrator) !== 0n ||
      event.roles.some((id) => roles.includes(id))
    );
  }
  async joined(event: JoinEvent) {
    if (!this.store.available()) return;
    const settings = await this.store.getSettings(event.guildId);
    if (this.exempt(event, settings.exemptRoles)) return;
    if (settings.antiRaid?.enabled) {
      const now = Date.now();
      const cutoff = now - settings.antiRaid.windowSeconds * 1000;
      const recent = (this.joinWindows.get(event.guildId) ?? []).filter((ts) => ts > cutoff);
      recent.push(now);
      if (this.joinWindows.size >= 1000 && !this.joinWindows.has(event.guildId))
        this.joinWindows.delete(this.joinWindows.keys().next().value!);
      this.joinWindows.set(event.guildId, recent);
      if (recent.length >= settings.antiRaid.joinThreshold) {
        await this.moderation.execute({
          guildId: event.guildId,
          targetId: event.userId,
          actorId: this.botId(),
          source: 'raid_protection',
          action: settings.antiRaid.action === 'kick' ? 'kick' : 'raid_alert',
          reason: `Join rate (${recent.length} joins in ${settings.antiRaid.windowSeconds}s) exceeded anti-raid threshold (${settings.antiRaid.joinThreshold}).`,
          requestKey: `raid:${event.userId}:${event.joinedAt}`,
          joinedAt: event.joinedAt,
        });
        if (settings.antiRaid.action === 'kick') return;
      }
    }
    if (!settings.accountAge.enabled) return;
    const age = (Date.now() - event.createdAt) / 86_400_000;
    if (age >= settings.accountAge.days) return;
    await this.moderation.execute({
      guildId: event.guildId,
      targetId: event.userId,
      actorId: this.botId(),
      source: 'account_age',
      action: settings.accountAge.action === 'kick' ? 'kick' : 'account_age_alert',
      reason: `Account age ${Math.max(0, age).toFixed(2)} days is below ${settings.accountAge.days} days.`,
      requestKey: `age:${event.userId}:${event.joinedAt}`,
      joinedAt: event.joinedAt,
    });
  }
  async message(event: MessageEvent) {
    if (!this.store.available()) return;
    const settings = await this.store.getSettings(event.guildId);
    if (
      !settings.invites.enabled ||
      settings.exemptChannels.includes(event.channelId) ||
      this.exempt(event, settings.exemptRoles)
    )
      return;
    const codes = inviteCodes(event.content);
    let external = false;
    let unresolved = false;
    for (const code of codes) {
      try {
        const guild = await this.resolver.resolve(code);
        if (guild === null) unresolved = true;
        else if (guild !== event.guildId) external = true;
      } catch {
        unresolved = true;
      }
      if (external) break;
    }
    if (external)
      await this.moderation.execute({
        guildId: event.guildId,
        targetId: event.userId,
        actorId: this.botId(),
        source: 'invite_filter',
        action: 'invite_delete',
        reason: 'Invite points to another server.',
        requestKey: `invite:${event.messageId}`,
        channelId: event.channelId,
        messageId: event.messageId,
      });
    else if (unresolved)
      await this.notify(
        event.guildId,
        'INVITE_LOOKUP',
        'An invite could not be resolved. The message was left in place. Check invite filtering and Discord access.',
      );
  }
  async automodExecution(event: AutoModEvent) {
    if (!this.store.available()) return;
    if (event.actionType !== 1) return;
    const settings = await this.store.getSettings(event.guildId);
    if (!settings.auditSync?.enabled) return;
    const keywordNote = event.matchedKeyword ? ` (${event.matchedKeyword})` : '';
    await this.moderation.execute({
      guildId: event.guildId,
      targetId: event.userId,
      actorId: this.botId(),
      source: 'audit_sync',
      action: 'automod_block',
      reason: `Blocked by native Discord AutoMod rule ${event.ruleId}${keywordNote}.`,
      requestKey: `automod:${event.ruleId}:${event.messageId ?? `${event.userId}:${Math.floor(Date.now() / 5000)}`}`,
      ...(event.channelId ? { channelId: event.channelId } : {}),
    });
  }
}
