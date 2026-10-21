import { ActionFailure } from './domain.js';
import type { DiscordPort, ModerationService } from './moderation/service.js';
import type { Store } from './storage/store.js';
import { errorCode, logger } from './logger.js';
export class DeliveryWorker {
  private running = false;
  private timer: NodeJS.Timeout | undefined;
  constructor(
    private readonly store: Store,
    private readonly discord: DiscordPort,
    private readonly moderation?: ModerationService,
    private readonly botId?: () => string,
  ) {}
  start() {
    this.timer = setInterval(() => void this.tick(), 1000);
    this.timer.unref();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (this.running || !this.store.available()) return;
    this.running = true;
    try {
      for (let count = 0; count < 10; count++) {
        const record = await this.store.claimStaff();
        if (!record) break;
        try {
          const messageId = await this.discord.sendStaff(record);
          await this.store.finishStaff(record, null, false, messageId);
        } catch (error) {
          await this.store.finishStaff(
            record,
            errorCode(error),
            error instanceof ActionFailure && error.certain,
          );
        }
      }
      if (this.moderation && this.store.claimExpired) {
        for (let count = 0; count < 5; count++) {
          const expired = await this.store.claimExpired();
          if (!expired) break;
          const actorId = this.botId ? this.botId() : expired.actorId;
          try {
            if (expired.action === 'tempban') {
              await this.moderation.execute({
                guildId: expired.guildId,
                targetId: expired.targetId,
                actorId,
                source: 'expiry',
                action: 'unban',
                reason: `Temporary ban expired (Case ${expired.caseNumber ? `#${expired.caseNumber}` : expired.id}).`,
                requestKey: `expiry:${expired.id}`,
              });
            } else if (expired.action === 'lock' && expired.channelId) {
              await this.moderation.execute({
                guildId: expired.guildId,
                targetId: expired.targetId,
                actorId,
                source: 'expiry',
                action: 'unlock',
                channelId: expired.channelId,
                reason: `Timed channel lock expired (Case ${expired.caseNumber ? `#${expired.caseNumber}` : expired.id}).`,
                requestKey: `expiry:${expired.id}`,
              });
            }
          } catch (error) {
            logger.warn(
              { caseId: expired.id, code: errorCode(error) },
              'Scheduled expiry reversal failed.',
            );
          }
        }
      }
    } catch {
      logger.warn('Staff log delivery is paused. Check database and Discord access.');
    } finally {
      this.running = false;
    }
  }
}
