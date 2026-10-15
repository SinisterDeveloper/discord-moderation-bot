import mongoose from 'mongoose';
import { Events } from 'discord.js';
import { readEnvironment } from './config.js';
import { createClient } from './discord/client.js';
import { DiscordAdapter } from './discord/adapter.js';
import { startHealth } from './health.js';
import { logger, errorCode } from './logger.js';
import { MongoStore } from './storage/store.js';
import { ModerationService } from './moderation/service.js';
import { DeliveryWorker } from './delivery.js';
import { CommandRouter } from './commands/router.js';
async function main() {
  const env = readEnvironment();
  const capabilities = {
    memberEvents: env.ENABLE_MEMBER_EVENTS,
    messageFilter: env.ENABLE_MESSAGE_FILTER,
  };
  const client = createClient(capabilities);
  let stopping = false;
  let worker: DeliveryWorker | undefined;
  const health = startHealth(
    env.HEALTH_HOST,
    env.HEALTH_PORT,
    () => !stopping && client.isReady() && mongoose.connection.readyState === 1,
  );
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    worker?.stop();
    client.destroy();
    health.close();
    await mongoose.disconnect();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  for (const event of ['unhandledRejection', 'uncaughtException'] as const)
    process.once(event, () => {
      logger.fatal(
        'A fatal process error occurred. Restart the service and review unresolved cases.',
      );
      process.exitCode = 1;
      void shutdown();
    });
  health.on('error', () => {
    logger.error('Health endpoint failed.');
    void shutdown();
    process.exitCode = 1;
  });
  client.on(Events.Error, (error) =>
    logger.error({ code: errorCode(error) }, 'Discord connection error.'),
  );
  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DATABASE,
      serverSelectionTimeoutMS: 10_000,
    });
    const store = new MongoStore(mongoose.connection);
    await store.init();
    await store.recover();
    const adapter = new DiscordAdapter(client);
    const service = new ModerationService(store, adapter);
    const router = new CommandRouter(client, store, service, capabilities);
    client.on(Events.InteractionCreate, (interaction) => {
      void router
        .handle(interaction)
        .catch(() => logger.error('Interaction error boundary caught a failure.'));
    });
    worker = new DeliveryWorker(store, adapter);
    client.once(Events.ClientReady, () => {
      worker!.start();
      logger.info('Bot ready.');
    });
    await client.login(env.DISCORD_TOKEN);
  } catch (error) {
    await shutdown();
    throw error;
  }
}
main().catch((error: unknown) => {
  logger.error(
    { code: errorCode(error) },
    error instanceof Error && error.message.startsWith('Invalid configuration:')
      ? error.message
      : 'Startup failed. Check credentials, database access, and privileged intents.',
  );
  process.exitCode = 1;
});
