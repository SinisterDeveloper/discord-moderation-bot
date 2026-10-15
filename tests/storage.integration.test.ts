import mongoose from 'mongoose';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoStore } from '../src/storage/store.js';
import { actorId, guildId, request, targetId } from './helpers.js';
import { importLegacy, inspectLegacy, type LegacySource } from '../src/storage/migration.js';
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
  it('imports twice without duplicates or overwriting existing v3 settings', async () => {
    const importedGuild = '1108716196024561770';
    const source: LegacySource = {
      settings: async function* () {
        yield { GuildID: importedGuild, MinimumAge: 4 };
      },
      cases: async function* () {
        yield {
          _id: new mongoose.Types.ObjectId('60a4fd600000000000000001'),
          Guild: importedGuild,
          User: targetId,
          Moderator: actorId,
          Type: 'Unmute',
          Reason: 'Historical action',
          Date: 'bad-date',
        };
      },
    };
    const preview = await inspectLegacy(source, 'legacy_fixture');
    const first = await importLegacy(source, 'legacy_fixture', store, preview);
    expect(first).toEqual({ settingsInserted: 1, casesInserted: 1 });
    const config = await store.getSettings(importedGuild);
    config.dmEnabled = false;
    await store.saveSettings(config);
    const second = await importLegacy(source, 'legacy_fixture', store, preview);
    expect(second).toEqual({ settingsInserted: 0, casesInserted: 0 });
    expect((await store.getSettings(importedGuild)).dmEnabled).toBe(false);
    expect((await store.listCases(importedGuild, targetId)).records[0]!.state).toBe(
      'legacy_unverified',
    );
  });
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
  it('exports and restores BSON values into a new database without changing the source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'v3-backup-'));
    const output = join(directory, 'backup.jsonl');
    const run = promisify(execFile);
    const args = ['node_modules/tsx/dist/cli.mjs', 'scripts/export.ts', '--all', '--out', output];
    const env = {
      ...process.env,
      MONGODB_URI: server.getUri(),
      MONGODB_DATABASE: 'v3_local_tests',
    };
    const restored = await mongoose
      .createConnection(server.getUri(), { dbName: 'v3_restore_tests' })
      .asPromise();
    try {
      const before = await store.cases.countDocuments({});
      await run(process.execPath, args, { env });
      const backup = await readFile(output, 'utf8');
      await expect(run(process.execPath, args, { env })).rejects.toThrow();
      expect(await readFile(output, 'utf8')).toBe(backup);
      for (const line of backup.trim().split('\n')) {
        const { kind, record } = mongoose.mongo.BSON.EJSON.parse(line) as {
          kind: 'settings' | 'case';
          record: mongoose.mongo.Document;
        };
        await restored
          .db!.collection(kind === 'settings' ? 'guild_settings_v3' : 'moderation_cases_v3')
          .insertOne(record);
      }
      const restoredStore = new MongoStore(restored);
      await restoredStore.init();
      expect(await restoredStore.cases.countDocuments({})).toBe(before);
      const source = await store.cases.findOne({ requestKey: 'interrupted' }).lean();
      const copy = await restoredStore.getCase(guildId, String(source!._id));
      expect(copy?.createdAt).toBeInstanceOf(Date);
      expect(copy?.createdAt).toEqual(source!.createdAt);
      expect(copy?.changes).toEqual(source!.changes);
      expect((await restoredStore.getSettings(guildId)).dmEnabled).toBe(false);
      expect(await store.cases.countDocuments({})).toBe(before);
    } finally {
      await restored.close();
      await rm(directory, { recursive: true });
    }
  }, 30_000);
  it('saves staff resolution and its new log delivery atomically', async () => {
    const settings = await store.getSettings(guildId);
    const { record } = await store.insertCase(request({ requestKey: 'resolution-log' }), {
      ...settings,
      logChannelId: '1560181480427225159',
    });
    await store.transition(guildId, record.id, ['pending'], 'executing');
    await store.transition(guildId, record.id, ['executing'], 'unknown', 'NETWORK');
    const claimed = await store.claimStaff();
    expect(claimed?.id).toBe(record.id);
    const change = {
      actorId,
      at: new Date(),
      kind: 'resolve' as const,
      previous: 'unknown',
      value: 'Discord audit log confirms the action.',
    };
    await expect(store.changeCase(guildId, record.id, change, 'succeeded')).rejects.toThrow(
      'sending',
    );
    await store.finishStaff(claimed!, null, false, '1234567890123456789');
    const resolved = await store.changeCase(guildId, record.id, change, 'succeeded');
    expect(resolved.state).toBe('succeeded');
    expect(resolved.staff.status).toBe('pending');
    expect(resolved.changes).toEqual([change]);
    const followup = await store.claimStaff();
    expect(followup?.id).toBe(record.id);
    await store.finishStaff(followup!, null, false, '1234567890123456790');
  });
  it('bounds temporary staff delivery retries and does not retry interrupted DMs', async () => {
    const { record } = await store.insertCase(request({ requestKey: 'delivery-retries' }), {
      ...(await store.getSettings(guildId)),
      dmEnabled: true,
      logChannelId: '1560181480427225159',
    });
    await store.transition(guildId, record.id, ['pending'], 'executing');
    await store.transition(guildId, record.id, ['executing'], 'succeeded');
    expect(await store.claimDM(guildId, record.id)).toBe(true);
    await store.recover();
    expect(await store.claimDM(guildId, record.id)).toBe(false);
    expect((await store.getCase(guildId, record.id))?.dm.status).toBe('failed');
    for (const attempt of [1, 2, 3]) {
      const claimed = await store.claimStaff();
      expect(claimed?.id).toBe(record.id);
      expect(claimed?.staff.attempts).toBe(attempt);
      if (attempt === 3) {
        await store.recover();
        break;
      }
      const before = Date.now();
      await store.finishStaff(claimed!, 'TEMPORARY', false);
      const saved = await store.getCase(guildId, record.id);
      expect(saved?.staff.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
        before + (attempt === 1 ? 10_000 : 60_000),
      );
      expect(await store.claimStaff()).toBeNull();
      await store.cases.updateOne(
        { guildId, _id: record.id },
        { $set: { 'staff.nextAttemptAt': new Date(0) } },
      );
    }
    expect((await store.getCase(guildId, record.id))?.staff.status).toBe('failed');
    expect(await store.claimStaff()).toBeNull();
  });
});
