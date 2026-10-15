import mongoose from 'mongoose';
import { Events, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { readEnvironment } from './config.js';
import { createClient } from './discord/client.js';
import { startHealth } from './health.js';
import { logger, errorCode } from './logger.js';
import { MongoStore } from './storage/store.js';
async function main() {
  const env = readEnvironment();
  const client = createClient({
    memberEvents: env.ENABLE_MEMBER_EVENTS,
    messageFilter: env.ENABLE_MESSAGE_FILTER,
  });
  let stopping = false;
  const health = startHealth(
    env.HEALTH_HOST,
    env.HEALTH_PORT,
    () => !stopping && client.isReady() && mongoose.connection.readyState === 1,
  );
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    client.destroy();
    health.close();
    await mongoose.disconnect();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  health.on('error', () => {
    logger.error('Health endpoint failed.');
    void shutdown();
    process.exitCode = 1;
  });
  client.on(Events.Error, (error) =>
    logger.error({ code: errorCode(error) }, 'Discord connection error.'),
  );
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;
    try {
      if (
        interaction.commandName === 'doctor' &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
      ) {
        await interaction.reply({
          content: 'You need Manage Server.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        content:
          interaction.commandName === 'ping'
            ? `Pong. Gateway: ${client.ws.ping} ms.`
            : `Database: ${mongoose.connection.readyState === 1 ? 'ready' : 'unavailable'}.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.error({ code: errorCode(error) }, 'Interaction failed.');
    }
  });
  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DATABASE,
      serverSelectionTimeoutMS: 10_000,
    });
    const store = new MongoStore(mongoose.connection);
    await store.init();
    await store.recover();
    await client.login(env.DISCORD_TOKEN);
    logger.info('Bot started.');
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
