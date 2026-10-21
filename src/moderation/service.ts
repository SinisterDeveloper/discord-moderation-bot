import { parseReason, snowflake } from '../config.js';
import {
  ActionFailure,
  UserError,
  type ActionRequest,
  type GuildSettings,
  type ModerationCase,
} from '../domain.js';
import type { Store } from '../storage/store.js';
import { errorCode, logger } from '../logger.js';
export interface DiscordPort {
  authorize(request: ActionRequest, settings: GuildSettings): Promise<'allowed' | 'noop'>;
  perform(request: ActionRequest, caseId: string, settings: GuildSettings): Promise<void>;
  sendDM(record: ModerationCase, settings?: GuildSettings): Promise<void>;
  sendStaff(record: ModerationCase): Promise<string>;
}
export class ModerationService {
  private readonly active = new Set<string>();
  constructor(
    private readonly store: Store,
    private readonly discord: DiscordPort,
  ) {}
  async validate(request: ActionRequest) {
    if (!this.store.available())
      throw new UserError('The database is unavailable. No action was performed.', 'UNAVAILABLE');
    return this.discord.authorize(request, await this.store.getSettings(request.guildId));
  }
  async execute(
    request: ActionRequest,
  ): Promise<{ record: ModerationCase | null; duplicate: boolean; noop: boolean }> {
    snowflake.parse(request.guildId);
    snowflake.parse(request.targetId);
    snowflake.parse(request.actorId);
    request = { ...request, reason: parseReason(request.reason) };
    if (
      request.action === 'timeout' &&
      (!request.durationMs || request.durationMs < 1000 || request.durationMs > 2_419_200_000)
    )
      throw new UserError('Timeouts must be between 1 second and 28 days.');
    if (
      request.action === 'tempban' &&
      (!request.durationMs || request.durationMs < 1000 || request.durationMs > 365 * 86_400_000)
    )
      throw new UserError('Temporary bans must be between 1 second and 365 days.');
    if (
      (request.action === 'tempban' || request.action === 'lock') &&
      request.durationMs &&
      !request.expiresAt
    ) {
      request = { ...request, expiresAt: new Date(Date.now() + request.durationMs) };
    }
    if (!this.store.available())
      throw new UserError('The database is unavailable. No action was performed.', 'UNAVAILABLE');
    const lock = `${request.guildId}:${request.targetId}`;
    if (this.active.has(lock))
      throw new UserError('Another action for this member is running. Try again.', 'BUSY');
    this.active.add(lock);
    try {
      const previous = await this.store.findRequest(request.guildId, request.requestKey);
      if (previous) {
        if (
          previous.actorId !== request.actorId ||
          previous.targetId !== request.targetId ||
          previous.action !== request.action
        )
          throw new UserError('This request key belongs to another action.', 'CONFLICT');
        return { record: previous, duplicate: true, noop: false };
      }
      const settings = await this.store.getSettings(request.guildId);
      if (
        request.action === 'warn' &&
        settings.escalations?.warnDecayDays &&
        settings.escalations.warnDecayDays > 0 &&
        !request.expiresAt
      ) {
        request = {
          ...request,
          expiresAt: new Date(Date.now() + settings.escalations.warnDecayDays * 86_400_000),
        };
      }
      if ((await this.discord.authorize(request, settings)) === 'noop')
        return { record: null, duplicate: false, noop: true };
      const { record, created } = await this.store.insertCase(request, settings);
      if (!created) return { record, duplicate: true, noop: false };
      await this.store.transition(request.guildId, record.id, ['pending'], 'executing');
      let state: 'succeeded' | 'failed' | 'unknown' = 'succeeded';
      let code: string | null = null;
      try {
        await this.discord.perform(request, record.id, settings);
      } catch (error) {
        state = error instanceof ActionFailure && error.certain ? 'failed' : 'unknown';
        code = errorCode(error);
      }
      let finished: ModerationCase;
      try {
        finished = await this.store.transition(
          request.guildId,
          record.id,
          ['executing'],
          state,
          code,
        );
      } catch {
        logger.error(
          { caseId: record.id },
          'The action outcome could not be saved. Staff review is required.',
        );
        return {
          record: { ...record, state: 'unknown', errorCode: 'OUTCOME_NOT_SAVED' },
          duplicate: false,
          noop: false,
        };
      }
      let sendDM = false;
      try {
        sendDM = state === 'succeeded' && (await this.store.claimDM(request.guildId, record.id));
      } catch {
        logger.warn({ caseId: record.id }, 'DM delivery could not be started.');
      }
      if (sendDM) {
        let dmError: string | null = null;
        try {
          await this.discord.sendDM(finished, settings);
        } catch (error) {
          dmError = errorCode(error);
        }
        finished.dm = {
          ...finished.dm,
          status: dmError ? 'failed' : 'sent',
          attempts: 1,
          errorCode: dmError,
        };
        try {
          await this.store.finishDM(request.guildId, record.id, dmError);
        } catch {
          logger.warn(
            { caseId: record.id },
            'DM delivery result could not be saved. It will not be retried.',
          );
        }
      }
      if (
        request.action === 'warn' &&
        state === 'succeeded' &&
        settings.escalations?.enabled &&
        settings.escalations.rules.length > 0
      ) {
        this.active.delete(lock);
        await this.evaluateEscalation(finished, settings);
      }
      return { record: finished, duplicate: false, noop: false };
    } finally {
      this.active.delete(lock);
    }
  }
  async evaluateEscalation(
    warnCase: ModerationCase,
    settings: GuildSettings,
  ): Promise<ModerationCase | null> {
    const esc = settings.escalations;
    if (
      warnCase.action !== 'warn' ||
      warnCase.state !== 'succeeded' ||
      !esc?.enabled ||
      !esc.rules.length
    )
      return null;
    const now = new Date();
    const sorted = [...esc.rules].sort((a, b) => b.threshold - a.threshold);
    for (const rule of sorted) {
      const since = new Date(now.getTime() - rule.windowDays * 86_400_000);
      const count = this.store.countActiveWarnings
        ? await this.store.countActiveWarnings(warnCase.guildId, warnCase.targetId, since, now)
        : (await this.store.listCases(warnCase.guildId, warnCase.targetId)).records.filter(
            (r) =>
              r.action === 'warn' &&
              r.state === 'succeeded' &&
              !r.revoked &&
              r.createdAt >= since &&
              (!r.expiresAt || r.expiresAt > now),
          ).length;
      if (count >= rule.threshold) {
        const ref = warnCase.caseNumber ? `#${warnCase.caseNumber}` : warnCase.id;
        try {
          const res = await this.execute({
            guildId: warnCase.guildId,
            targetId: warnCase.targetId,
            actorId: warnCase.actorId,
            source: 'escalation',
            action: rule.action,
            ...(rule.durationMs ? { durationMs: rule.durationMs } : {}),
            reason: `Automated escalation: ${count} active warnings within ${rule.windowDays}d (triggered by Case ${ref}).`,
            requestKey: `escalation:${warnCase.id}:${rule.threshold}`,
          });
          return res.record;
        } catch (error) {
          logger.warn(
            { caseId: warnCase.id, code: errorCode(error) },
            'Automated warning escalation could not be completed.',
          );
          return null;
        }
      }
    }
    return null;
  }
}
