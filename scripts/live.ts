import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import {
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits as P,
  REST,
  Routes,
} from 'discord.js';
import { z } from 'zod';
import { readEnvironment, snowflake } from '../src/config.js';
import { createClient } from '../src/discord/client.js';
import {
  LiveModerationService,
  ScopedDiscordAdapter,
  ScopedNativePort,
} from '../src/live/adapters.js';
import { CommandRouter } from '../src/commands/router.js';
import { DeliveryWorker } from '../src/delivery.js';
import { UserError, type Action, type GuildSettings } from '../src/domain.js';
import { errorCode } from '../src/logger.js';
import { assertLiveScope, assertLiveTarget, liveScope, liveSettings } from '../src/live/scope.js';
import { AutoModManager } from '../src/policies/automod.js';
import { attachPolicies } from '../src/policies/events.js';
import { MongoStore } from '../src/storage/store.js';
import { embedReply, textEmbed } from '../src/discord/presentation.js';
const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'preflight' },
    seconds: { type: 'string', default: '300' },
  },
});
const mode = z
  .enum(['preflight', 'services', 'interactive', 'kick', 'ban', 'membership'])
  .parse(values.mode);
const seconds = z.coerce
  .number()
  .int()
  .max(1800)
  .refine((value) => value === 0 || value >= 30, 'Use 0, or 30–1800 seconds.')
  .parse(values.seconds);
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`;
const report = {
  runId,
  mode,
  node: process.version,
  scope: liveScope,
  resources: {
    roleId: null as string | null,
    ruleIds: [] as string[],
    originalTimeout: null as string | null,
    baselineSettings: null as GuildSettings | null,
  },
  checks: [] as {
    name: string;
    status: 'passed' | 'failed' | 'blocked' | 'pending';
    detail?: string;
  }[],
  cleanup: [] as { resource: string; status: 'restored' | 'failed' }[],
};
const reportPath = `.local/live-${runId}.json`;
const save = async () => {
  await mkdir('.local', { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
};
const pass = async (name: string, detail?: string) => {
  report.checks.push({ name, status: 'passed', ...(detail ? { detail } : {}) });
  console.log(`PASS: ${name}`);
  await save();
};
let client: ReturnType<typeof createClient> | undefined;
let connection: mongoose.Connection | undefined;
let store: MongoStore | undefined;
let worker: DeliveryWorker | undefined;
let baseline: GuildSettings | undefined;
let originalTimeout: Date | null = null;
let restoreTimeout = false;
let restoreBan = false;
let temporaryRole: string | undefined;
const newRules = new Set<string>();
const initialRules = new Set<string>();
const s = liveScope;
try {
  const env = readEnvironment();
  assertLiveScope(s.guildId, s.channelId, s.targetId);
  const database = z
    .string()
    .regex(/^[\w-]+_e2e$/)
    .max(38)
    .parse(process.env.LIVE_DATABASE);
  if (database === env.MONGODB_DATABASE)
    throw new UserError('Live tests must use a separate test database.');
  const rest = new REST({ version: '10', timeout: 10_000, retries: 0 }).setToken(env.DISCORD_TOKEN);
  const userSchema = z.object({ id: snowflake, bot: z.boolean().optional() });
  const me = userSchema.parse(await rest.get(Routes.user('@me')));
  if (me.id !== env.APPLICATION_ID || !me.bot)
    throw new UserError('The authenticated bot does not match APPLICATION_ID.');
  await pass('Bot authentication');
  connection = await mongoose
    .createConnection(env.MONGODB_URI, { dbName: database, serverSelectionTimeoutMS: 10_000 })
    .asPromise();
  await connection.db!.command({ ping: 1 });
  await pass('Atlas connection', `Separate test database: ${database}`);
  const guild = z
    .object({ id: snowflake, owner_id: snowflake })
    .parse(await rest.get(Routes.guild(s.guildId)));
  const channel = z
    .object({ id: snowflake, guild_id: snowflake })
    .parse(await rest.get(Routes.channel(s.channelId)));
  if (channel.guild_id !== s.guildId)
    throw new UserError('The test channel is outside the authorized server.');
  const memberSchema = z.object({
    user: userSchema,
    roles: z.array(snowflake),
    communication_disabled_until: z.string().nullable().optional(),
  });
  const target = memberSchema.parse(await rest.get(Routes.guildMember(s.guildId, s.targetId)));
  assertLiveTarget(target.user.id, guild.owner_id, me.id, target.user.bot ?? false);
  const bot = memberSchema.parse(await rest.get(Routes.guildMember(s.guildId, me.id)));
  const roles = z
    .array(z.object({ id: snowflake, permissions: z.string(), position: z.number() }))
    .parse(await rest.get(Routes.guildRoles(s.guildId)));
  const bits = roles
    .filter((r) => r.id === s.guildId || bot.roles.includes(r.id))
    .reduce((value, role) => value | BigInt(role.permissions), 0n);
  const has = (p: bigint) => (bits & P.Administrator) !== 0n || (bits & p) === p;
  const needed =
    P.BanMembers |
    P.KickMembers |
    P.ModerateMembers |
    P.ManageMessages |
    P.ManageGuild |
    P.ManageRoles;
  if (!has(needed))
    throw new UserError('The bot lacks required live-test permissions. Check /doctor.');
  const highest = (ids: string[]) =>
    Math.max(
      ...roles.filter((r) => r.id === s.guildId || ids.includes(r.id)).map((r) => r.position),
    );
  if (highest(bot.roles) <= highest(target.roles))
    throw new UserError('Move the bot role above the disposable target before testing.');
  const targetBits = roles
    .filter((r) => r.id === s.guildId || target.roles.includes(r.id))
    .reduce((value, role) => value | BigInt(role.permissions), 0n);
  if ((targetBits & P.Administrator) !== 0n)
    throw new UserError('Use a disposable target without Administrator.');
  originalTimeout = target.communication_disabled_until
    ? new Date(target.communication_disabled_until)
    : null;
  await pass('Server, channel, disposable target, role order, and permissions');
  if (mode !== 'preflight') {
    store = new MongoStore(connection);
    await store.init();
    await store.recover();
    baseline = await store.getSettings(s.guildId);
    report.resources.baselineSettings = structuredClone(baseline);
    report.resources.originalTimeout = originalTimeout?.toISOString() ?? null;
    await save();
    await store.saveSettings(liveSettings(baseline));
    const interactive = mode === 'interactive';
    const capabilities = { memberEvents: interactive, messageFilter: interactive };
    client = createClient(capabilities);
    if (interactive) client.options.intents.add(GatewayIntentBits.AutoModerationExecution);
    const ready = once(client, Events.ClientReady, { signal: AbortSignal.timeout(30_000) });
    await client.login(env.DISCORD_TOKEN);
    await ready;
    await pass('Gateway connection');
    const adapter = new ScopedDiscordAdapter(client);
    const service = new LiveModerationService(store, adapter, runId);
    const native = new AutoModManager(store, new ScopedNativePort(client));
    const nativePort = new ScopedNativePort(client);
    for (const rule of await nativePort.list(s.guildId)) initialRules.add(rule.id);
    const rememberRules = async () => {
      const settings = await store!.getSettings(s.guildId);
      for (const rule of await nativePort.list(s.guildId)) {
        if (
          !initialRules.has(rule.id) &&
          rule.creator_id === me.id &&
          Object.values(settings.automod).some((p) => rule.name.endsWith(`[${p.key}]`))
        )
          newRules.add(rule.id);
      }
      report.resources.ruleIds = [...newRules];
      await save();
    };
    const execute = async (action: Action, label: string, durationMs?: number) => {
      const request = {
        ...s,
        actorId: me.id,
        action,
        source: 'live_test' as const,
        targetId: s.targetId,
        reason: `V3 live test ${runId}: ${label}`,
        requestKey: `${runId}:${label}`,
        runId,
        ...(durationMs ? { durationMs } : {}),
      };
      const result = await service.execute(request);
      if (result.record && result.record.state !== 'succeeded')
        throw new UserError(
          `${label} requires review; case ${result.record.id} has outcome ${result.record.state}.`,
        );
      await pass(label, result.record ? `Case ${result.record.id}` : 'No change needed.');
      return { request, result };
    };
    worker = new DeliveryWorker(store, adapter);
    if (mode === 'services') {
      const { request, result } = await execute('warn', 'Warning persistence');
      const repeated = await service.execute(request);
      if (!repeated.duplicate || repeated.record?.id !== result.record?.id)
        throw new UserError('Request deduplication failed.');
      await pass('Duplicate request does not repeat an action');
      const page = await store.listCases(s.guildId, s.targetId);
      if (!page.records.some((r) => r.id === result.record!.id))
        throw new UserError('Case history did not include the warning.');
      await store.changeCase(s.guildId, result.record!.id, {
        actorId: me.id,
        at: new Date(),
        kind: 'reason',
        previous: request.reason,
        value: `V3 live test ${runId}: amended warning`,
      });
      await store.changeCase(s.guildId, result.record!.id, {
        actorId: me.id,
        at: new Date(),
        kind: 'revoke',
        previous: 'succeeded',
        value: 'Live test warning revoked.',
      });
      await pass('History, reason amendment, and warning revocation');
      restoreTimeout = true;
      await execute('timeout', 'Native timeout', 60_000);
      if (
        !(
          await (
            await client.guilds.fetch(s.guildId)
          ).members.fetch({ user: s.targetId, force: true })
        ).isCommunicationDisabled()
      )
        throw new UserError('Discord did not apply the timeout.');
      await execute('untimeout', 'Native timeout removal');
      const guild = await client.guilds.fetch(s.guildId);
      const role = await guild.roles.create({
        name: `v3-test-${runId.slice(-6)}`,
        permissions: [],
        reason: 'Temporary v3 live test role.',
      });
      temporaryRole = role.id;
      report.resources.roleId = role.id;
      await save();
      await (
        await guild.members.fetch(s.targetId)
      ).roles.add(role, 'Temporary v3 legacy release test.');
      const settings = await store.getSettings(s.guildId);
      settings.legacyMuteRoleId = role.id;
      await store.saveSettings(settings);
      await execute('legacy_unmute', 'Legacy role release');
      if ((await guild.members.fetch({ user: s.targetId, force: true })).roles.cache.has(role.id))
        throw new UserError('Legacy role was not removed.');
      await native.configure(s.guildId, 'keywords', {
        keywords: `v3-e2e-${runId.slice(-6)}`,
        categories: null,
        limit: null,
      });
      for (const preset of ['keywords', 'mentions', 'words'] as const) {
        const preview = await native.preview(s.guildId, preset, true);
        try {
          await native.apply(s.guildId, preset, true, preview.fingerprint);
        } finally {
          await rememberRules();
        }
        await pass(`Native AutoMod ${preset} application`);
        const disable = await native.preview(s.guildId, preset, false);
        await native.apply(s.guildId, preset, false, disable.fingerprint);
      }
      await worker.tick();
      await pass('Staff log delivery worker');
      report.checks.push({
        name: 'Actual slash commands, user messages, and join events',
        status: 'pending',
        detail: 'Run interactive mode with a human participant.',
      });
    } else if (mode === 'kick' || mode === 'membership') {
      await execute('kick', 'Kick disposable member');
      try {
        await rest.get(Routes.guildMember(s.guildId, s.targetId));
        throw new UserError('Target still appears in the server.');
      } catch (error) {
        if (errorCode(error) !== '10007') throw error;
      }
      if (mode === 'membership') {
        restoreBan = true;
        await execute('ban', 'Ban disposable user by ID after kick');
        await rest.get(Routes.guildBan(s.guildId, s.targetId));
        await execute('unban', 'Unban disposable user');
        restoreBan = false;
      }
      report.checks.push({
        name: 'Target rejoin',
        status: 'pending',
        detail: 'The disposable member must rejoin using Discord.',
      });
      await worker.tick();
    } else if (mode === 'ban') {
      restoreBan = true;
      await execute('ban', 'Ban disposable member');
      await rest.get(Routes.guildBan(s.guildId, s.targetId));
      await execute('unban', 'Unban disposable member');
      restoreBan = false;
      await worker.tick();
      report.checks.push({
        name: 'Target rejoin',
        status: 'pending',
        detail: 'The disposable member must rejoin using Discord.',
      });
    } else {
      const router = new CommandRouter(client, store, service, capabilities, native);
      attachPolicies(client, store, service, capabilities, {
        guildId: s.guildId,
        targetId: s.targetId,
        channelId: s.channelId,
      });
      worker.start();
      client.on(Events.InteractionCreate, (interaction) => {
        void (async () => {
          if (
            interaction.guildId !== s.guildId ||
            interaction.channelId !== s.channelId ||
            (!interaction.isChatInputCommand() && !interaction.isButton())
          )
            return;
          if (interaction.isChatInputCommand()) {
            const selectedChannel =
              interaction.options.getChannel('log-channel')?.id ??
              interaction.options.getChannel('channel')?.id;
            if (selectedChannel && selectedChannel !== s.channelId) {
              await interaction.reply({
                ...embedReply(
                  textEmbed(
                    'Test scope',
                    'Use the authorized test channel in this run.',
                    'warning',
                  ),
                ),
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            const target =
              interaction.options.getUser('user')?.id ??
              interaction.options.getString('target')?.replace(/^<@!?(\d+)>$/, '$1') ??
              interaction.options.getString('user-id');
            if (target && target !== s.targetId) {
              await interaction.reply({
                ...embedReply(
                  textEmbed(
                    'Test scope',
                    'This live run accepts only the authorized disposable target.',
                    'warning',
                  ),
                ),
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
          }
          restoreTimeout = true;
          restoreBan = true;
          const ok = await router.handle(interaction);
          report.checks.push({
            name: `Real interaction handled: ${interaction.isChatInputCommand() ? interaction.commandName : 'button'}`,
            status: ok ? 'passed' : 'failed',
          });
          await rememberRules();
          await save();
        })().catch(() => {
          report.checks.push({ name: 'Interactive request', status: 'failed' });
          void save();
        });
      });
      client.on(Events.AutoModerationActionExecution, (event) => {
        if (
          event.guild.id === s.guildId &&
          event.userId === s.targetId &&
          newRules.has(event.ruleId)
        ) {
          report.checks.push({
            name: `Native AutoMod execution: rule ${event.ruleId}, action ${event.action.type}`,
            status: 'passed',
          });
          void save();
        }
      });
      console.log(
        `Interactive checks are ready ${seconds ? `for ${seconds} seconds` : 'until stopped'}. Run commands in the authorized server. Press Ctrl+C to finish and clean up.`,
      );
      await new Promise<void>((resolve) => {
        const end = () => {
          clearTimeout(timer);
          process.removeListener('SIGINT', end);
          process.removeListener('SIGTERM', end);
          resolve();
        };
        const timer = seconds ? setTimeout(end, seconds * 1000) : undefined;
        process.once('SIGINT', end);
        process.once('SIGTERM', end);
      });
      await worker.tick();
      const observed = await store.cases
        .find({
          guildId: s.guildId,
          targetId: s.targetId,
          source: { $in: ['account_age', 'invite_filter'] },
          runId,
        })
        .lean();
      for (const record of observed)
        report.checks.push({
          name: `Observed policy: ${record.action}`,
          status: record.state === 'succeeded' ? 'passed' : 'failed',
        });
      const required = ['ping', 'doctor', 'warn', 'cases', 'case', 'timeout', 'untimeout'];
      for (const name of required) {
        if (
          !report.checks.some(
            (c) => c.name === `Real interaction handled: ${name}` && c.status === 'passed',
          )
        )
          report.checks.push({
            name: `Human check: /${name}`,
            status: 'pending',
            detail: 'No successful real interaction was observed.',
          });
      }
      for (const action of ['account_age_alert', 'invite_delete']) {
        if (!observed.some((c) => c.action === action && c.state === 'succeeded'))
          report.checks.push({ name: `Human policy check: ${action}`, status: 'pending' });
      }
      if (!report.checks.some((c) => c.name.startsWith('Native AutoMod execution:')))
        report.checks.push({ name: 'Human native AutoMod trigger', status: 'pending' });
    }
  }
} catch (error) {
  const detail = error instanceof UserError ? error.message : `Reference: ${errorCode(error)}.`;
  report.checks.push({ name: 'Live run', status: 'blocked', detail });
  console.log(`BLOCKED: ${detail}`);
  process.exitCode = 1;
} finally {
  worker?.stop();
  const cleanup = async (name: string, action: () => Promise<unknown>) => {
    try {
      await action();
      report.cleanup.push({ resource: name, status: 'restored' });
    } catch {
      report.cleanup.push({ resource: name, status: 'failed' });
      process.exitCode = 1;
    }
    await save();
  };
  if (client?.isReady()) {
    const activeClient = client;
    if (restoreBan)
      await cleanup('Disposable target ban', async () => {
        try {
          await activeClient.rest.delete(Routes.guildBan(s.guildId, s.targetId), {
            reason: 'Restore v3 test baseline.',
          });
        } catch (error) {
          if (errorCode(error) !== '10026') throw error;
        }
      });
    if (restoreTimeout)
      await cleanup('Disposable target timeout', async () => {
        try {
          await (
            await activeClient.guilds.fetch(s.guildId)
          ).members.edit(s.targetId, {
            communicationDisabledUntil:
              originalTimeout && originalTimeout.getTime() > Date.now() ? originalTimeout : null,
            reason: 'Restore v3 test baseline.',
          });
        } catch (error) {
          if (errorCode(error) !== '10007') throw error;
        }
      });
    for (const id of newRules)
      await cleanup(`Created AutoMod rule ${id}`, async () => {
        const rule = (await activeClient.rest.get(
          Routes.guildAutoModerationRule(s.guildId, id),
        )) as { creator_id: string };
        if (rule.creator_id !== activeClient.user.id) throw new Error('Rule ownership changed.');
        await activeClient.rest.delete(Routes.guildAutoModerationRule(s.guildId, id), {
          reason: 'Remove rule created by this v3 test run.',
        });
      });
    if (temporaryRole)
      await cleanup(`Created test role ${temporaryRole}`, () =>
        activeClient.guilds
          .fetch(s.guildId)
          .then((guild) =>
            guild.roles.delete(temporaryRole!, 'Remove role created by this v3 test run.'),
          ),
      );
  }
  if (baseline && store)
    await cleanup('Test database settings', async () => {
      const current = await store!.getSettings(s.guildId);
      await store!.saveSettings({ ...baseline!, version: current.version });
    });
  client?.destroy();
  await connection?.close();
  await save();
  console.log(
    `Report saved: ${reportPath}. Test records were retained; no database records, collections, or databases were deleted.`,
  );
}
