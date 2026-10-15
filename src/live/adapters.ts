import type { Client } from 'discord.js';
import { DiscordAdapter } from '../discord/adapter.js';
import {
  UserError,
  type ActionRequest,
  type GuildSettings,
  type ModerationCase,
} from '../domain.js';
import { DiscordNativePort, type RuleSpec } from '../policies/automod.js';
import { assertLiveScope, liveScope } from './scope.js';
import { ModerationService, type DiscordPort } from '../moderation/service.js';
import type { Store } from '../storage/store.js';
export class LiveModerationService extends ModerationService {
  constructor(
    store: Store,
    discord: DiscordPort,
    private readonly runId: string,
  ) {
    super(store, discord);
  }
  override execute(request: ActionRequest) {
    assertLiveScope(request.guildId, request.channelId ?? liveScope.channelId, request.targetId);
    return super.execute({ ...request, runId: this.runId });
  }
}
export class ScopedDiscordAdapter extends DiscordAdapter {
  private check(request: { guildId: string; targetId: string; channelId?: string }) {
    assertLiveScope(request.guildId, request.channelId ?? liveScope.channelId, request.targetId);
  }
  override authorize(request: ActionRequest, settings: GuildSettings) {
    this.check(request);
    return super.authorize(request, settings);
  }
  override perform(request: ActionRequest, caseId: string, settings: GuildSettings) {
    this.check(request);
    return super.perform(request, caseId, settings);
  }
  override sendDM(record: ModerationCase) {
    this.check(record);
    return super.sendDM(record);
  }
  override sendStaff(record: ModerationCase) {
    this.check(record);
    if (record.logChannelId !== liveScope.channelId)
      throw new UserError('Live staff logs are restricted to the authorized channel.');
    return super.sendStaff(record);
  }
}
export class ScopedNativePort extends DiscordNativePort {
  constructor(client: Client) {
    super(client);
  }
  private check(guildId: string, spec?: Partial<RuleSpec>) {
    if (guildId !== liveScope.guildId)
      throw new UserError('Native live tests are restricted to the authorized server.');
    if (spec?.actions?.some((a) => a.type === 2 && a.metadata?.channel_id !== liveScope.channelId))
      throw new UserError('Native live alerts are restricted to the authorized channel.');
  }
  override list(guildId: string) {
    this.check(guildId);
    return super.list(guildId);
  }
  override create(guildId: string, spec: RuleSpec) {
    this.check(guildId, spec);
    return super.create(guildId, spec);
  }
  override edit(guildId: string, id: string, spec: Partial<RuleSpec>) {
    this.check(guildId, spec);
    return super.edit(guildId, id, spec);
  }
  override checkLog(guildId: string, channelId: string) {
    this.check(guildId);
    if (channelId !== liveScope.channelId)
      throw new UserError('Choose the authorized live-test channel.');
    return super.checkLog(guildId, channelId);
  }
}
