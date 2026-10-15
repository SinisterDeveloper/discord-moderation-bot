import { ActionFailure } from './domain.js';
import type { DiscordPort } from './moderation/service.js';
import type { Store } from './storage/store.js';
import { errorCode, logger } from './logger.js';
export class DeliveryWorker {
  private running = false;
  private timer: NodeJS.Timeout | undefined;
  constructor(
    private readonly store: Store,
    private readonly discord: DiscordPort,
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
    } catch {
      logger.warn('Staff log delivery is paused. Check database and Discord access.');
    } finally {
      this.running = false;
    }
  }
}
