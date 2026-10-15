import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { GatewayIntentBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { createClient } from '../src/discord/client.js';
import { startHealth } from '../src/health.js';
describe('runtime boundaries', () => {
  it('requests privileged intents only for explicit capabilities', () => {
    const minimal = createClient({ memberEvents: false, messageFilter: false });
    expect(minimal.options.intents.has(GatewayIntentBits.Guilds)).toBe(true);
    expect(minimal.options.intents.has(GatewayIntentBits.GuildMembers)).toBe(false);
    expect(minimal.options.intents.has(GatewayIntentBits.MessageContent)).toBe(false);
    const policies = createClient({ memberEvents: true, messageFilter: true });
    expect(policies.options.intents.has(GatewayIntentBits.GuildMembers)).toBe(true);
    expect(policies.options.intents.has(GatewayIntentBits.MessageContent)).toBe(true);
    expect(policies.options.rest?.retries).toBe(0);
    minimal.destroy();
    policies.destroy();
  });
  it('reports readiness without disclosing configuration or user data', async () => {
    let ready = false;
    const server = startHealth('127.0.0.1', 0, () => ready);
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/livez`)).status).toBe(200);
      const unavailable = await fetch(`${base}/readyz`);
      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toEqual({ status: 'not_ready' });
      ready = true;
      const healthy = await fetch(`${base}/readyz`);
      expect(await healthy.json()).toEqual({ status: 'ok' });
      expect((await fetch(`${base}/other`)).status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
