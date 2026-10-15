import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoStore } from '../src/storage/store.js';
import { actorId, guildId, request, targetId } from './helpers.js';
let server: MongoMemoryServer;
let connection: mongoose.Connection;
let store: MongoStore;
beforeAll(async () => {
  server = await MongoMemoryServer.create({ binary: { version: '8.0.17' } });
  connection = await mongoose
    .createConnection(server.getUri(), { dbName: 'v3_local_tests' })
    .asPromise();
  store = new MongoStore(connection);
  await store.init();
}, 180_000);
afterAll(async () => {
  await connection?.close();
  await server?.stop();
});
describe('MongoDB storage', () => {
  it('keeps server histories separate and deduplicates concurrent insertion', async () => {
    const settings = await store.getSettings(guildId);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.insertCase(request(), settings)),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const other = '1108716196024561765';
    await store.insertCase(request({ guildId: other }), await store.getSettings(other));
    expect((await store.listCases(guildId, targetId)).records).toHaveLength(1);
    expect(await store.getCase(other, results[0]!.record.id)).toBeNull();
  });
  it('rejects stale settings updates', async () => {
    const first = await store.getSettings(guildId);
    const second = structuredClone(first);
    first.dmEnabled = false;
    await store.saveSettings(first);
    await expect(store.saveSettings(second)).rejects.toThrow('changed');
  });
  it('paginates tied dates without duplicates', async () => {
    const settings = await store.getSettings(guildId);
    for (let i = 0; i < 14; i++)
      await store.insertCase(request({ requestKey: `page:${i}` }), settings);
    const page = await store.listCases(guildId, targetId);
    const next = await store.listCases(guildId, targetId, page.next!);
    expect(page.records).toHaveLength(10);
    expect(new Set([...page.records, ...next.records].map((c) => c.id)).size).toBe(15);
  });
  it('recovers interrupted actions without retrying them', async () => {
    const settings = await store.getSettings(guildId);
    const { record } = await store.insertCase(request({ requestKey: 'interrupted' }), settings);
    await store.transition(guildId, record.id, ['pending'], 'executing');
    await store.recover();
    expect((await store.getCase(guildId, record.id))?.state).toBe('unknown');
    expect(await store.unresolved(guildId)).toBe(1);
  });
  it('amends atomically and resolves only uncertain cases', async () => {
    const cases = await store.cases.find({ requestKey: 'interrupted' }).lean();
    const id = String(cases[0]!._id);
    const changed = await store.changeCase(guildId, id, {
      actorId,
      at: new Date(),
      kind: 'reason',
      previous: 'Test reason',
      value: 'Amended reason',
    });
    expect(changed.changes).toHaveLength(1);
    await store.changeCase(
      guildId,
      id,
      { actorId, at: new Date(), kind: 'resolve', previous: 'unknown', value: 'Verified manually' },
      'failed',
    );
    await expect(
      store.changeCase(
        guildId,
        id,
        { actorId, at: new Date(), kind: 'resolve', previous: 'unknown', value: 'Again' },
        'succeeded',
      ),
    ).rejects.toThrow();
  });
});
