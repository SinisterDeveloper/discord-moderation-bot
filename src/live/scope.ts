import { UserError } from '../domain.js';
export const liveScope = {
  guildId: '1108716196024561764',
  channelId: '1560181480427225159',
  targetId: '852903412462387213',
} as const;
export function assertLiveScope(guildId: string, channelId: string, targetId: string) {
  if (
    guildId !== liveScope.guildId ||
    channelId !== liveScope.channelId ||
    targetId !== liveScope.targetId
  )
    throw new UserError('Live tests are restricted to the authorized server, channel, and target.');
}
export function assertLiveTarget(
  targetId: string,
  ownerId: string,
  botId: string,
  targetBot: boolean,
) {
  if (targetId === ownerId || targetId === botId || targetBot)
    throw new UserError(
      'Live moderation requires a disposable human member who is not the server owner or application bot.',
    );
}
