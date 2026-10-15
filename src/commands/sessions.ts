import { randomUUID } from 'node:crypto';
import { UserError } from '../domain.js';
export class Sessions<T> {
  private readonly items = new Map<
    string,
    { actorId: string; guildId: string; expires: number; value: T }
  >();
  create(actorId: string, guildId: string, value: T): string {
    if (this.items.size >= 1000)
      throw new UserError('Too many pending requests. Try again shortly.');
    const id = randomUUID();
    this.items.set(id, { actorId, guildId, value, expires: Date.now() + 60_000 });
    setTimeout(() => this.items.delete(id), 60_000).unref();
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
    this.items.delete(id);
    return session.value;
  }
}
