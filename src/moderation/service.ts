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
  sendDM(record: ModerationCase): Promise<void>;
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
          await this.discord.sendDM(finished);
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
      return { record: finished, duplicate: false, noop: false };
    } finally {
      this.active.delete(lock);
    }
  }
}
