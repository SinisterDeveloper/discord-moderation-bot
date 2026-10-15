import { REST, Routes } from 'discord.js';
import { z } from 'zod';
import { snowflake } from '../src/config.js';
import { commandDefinitions } from '../src/commands/definitions.js';
import { errorCode } from '../src/logger.js';
const args = process.argv.slice(2);
try {
  const token = z.string().min(20).parse(process.env.DISCORD_TOKEN);
  const applicationId = snowflake.parse(process.env.APPLICATION_ID);
  const rest = new REST({ version: '10', timeout: 10_000, retries: 0 }).setToken(token);
  const guild = args.includes('--guild')
    ? snowflake.parse(args[args.indexOf('--guild') + 1])
    : undefined;
  if (!guild && !args.includes('--global')) throw new Error('Choose --guild ID or --global.');
  await rest.put(
    guild
      ? Routes.applicationGuildCommands(applicationId, guild)
      : Routes.applicationCommands(applicationId),
    {
      body: guild
        ? commandDefinitions.map(
            ({ contexts: ignoredContexts, integration_types: ignoredTypes, ...command }) => {
              void ignoredContexts;
              void ignoredTypes;
              return command;
            },
          )
        : commandDefinitions,
    },
  );
  console.log(`Deployed ${commandDefinitions.length} commands to ${guild ?? 'global scope'}.`);
} catch (error) {
  console.error(
    `Command deployment failed (${errorCode(error)}). Check configuration and application access.`,
  );
  process.exitCode = 1;
}
