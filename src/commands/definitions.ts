import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
export const commandDefinitions = [
  new SlashCommandBuilder().setName('ping').setDescription('Check the bot connection.'),
  new SlashCommandBuilder()
    .setName('doctor')
    .setDescription('Check configuration and service health.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((command) => command.setContexts(InteractionContextType.Guild).toJSON());
