import { Client, GatewayIntentBits } from 'discord.js';
import type { Capabilities } from '../config.js';
export function createClient(capabilities: Capabilities) {
  const intents = [GatewayIntentBits.Guilds];
  if (capabilities.memberEvents) intents.push(GatewayIntentBits.GuildMembers);
  if (capabilities.messageFilter)
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  return new Client({ intents, allowedMentions: { parse: [], repliedUser: false } });
}
