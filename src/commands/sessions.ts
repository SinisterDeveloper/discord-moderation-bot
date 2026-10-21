import { randomUUID } from 'node:crypto';
import { UserError } from '../domain.js';
export class Sessions<T> {
  private readonly items = new Map<
    string,
    { actorId: string; guildId: string; expires: number; keep: boolean; ttlMs: number; value: T }
  >();
  create(actorId: string, guildId: string, value: T, keep = false, ttlMs = 60_000): string {
    if (this.items.size >= 1000)
      throw new UserError('Too many pending requests. Try again shortly.');
    const id = randomUUID();
    this.items.set(id, {
      actorId,
      guildId,
      value,
      keep,
      ttlMs,
      expires: Date.now() + ttlMs,
    });
    setTimeout(() => this.items.delete(id), ttlMs).unref();
    return id;
  }
  take(id: string, actorId: string, guildId: string): T {
    const session = this.items.get(id);
    if (!session || session.expires <= Date.now()) {
      this.items.delete(id);
      throw new UserError('This request expired. Run the command again.');
    }
    if (session.actorId !== actorId || session.guildId !== guildId)
      throw new UserError('This control belongs to another request.');
    if (session.keep) {
      session.expires = Date.now() + session.ttlMs;
    } else {
      this.items.delete(id);
    }
    return session.value;
  }
}
