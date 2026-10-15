import { PermissionFlagsBits as P } from 'discord.js';
import { UserError, type ActionRequest } from '../domain.js';
export const actionPermissions = {
  ban: P.BanMembers,
  unban: P.BanMembers,
  kick: P.KickMembers,
  warn: P.ModerateMembers,
  timeout: P.ModerateMembers,
  untimeout: P.ModerateMembers,
  legacy_unmute: P.ModerateMembers,
  account_age_alert: 0n,
  invite_delete: P.ManageMessages,
  legacy_mute: 0n,
  legacy_unknown: 0n,
};
export const botPermissions = { ...actionPermissions, warn: 0n, legacy_unmute: P.ManageRoles };
export interface PermissionContext {
  ownerId: string;
  botId: string;
  actorPermissions: bigint;
  botPermissions: bigint;
  targetExists: boolean;
  targetAdministrator: boolean;
  targetBot: boolean;
  actorAboveTarget: boolean;
  botAboveTarget: boolean;
}
function has(bits: bigint, permission: bigint) {
  return (bits & P.Administrator) !== 0n || (bits & permission) === permission;
}
export function checkPermissions(request: ActionRequest, context: PermissionContext) {
  const manual = request.source === 'manual';
  if (manual && request.targetId === request.actorId)
    throw new UserError('You cannot target yourself.');
  if (request.targetId === context.botId)
    throw new UserError('This action cannot target the application bot.');
  if (
    manual &&
    request.actorId !== context.ownerId &&
    !has(context.actorPermissions, actionPermissions[request.action])
  )
    throw new UserError('You do not have permission for this action.');
  if (!has(context.botPermissions, botPermissions[request.action]))
    throw new UserError('The bot is missing a permission required for this action.');
  if (
    request.action === 'invite_delete' ||
    request.action === 'account_age_alert' ||
    request.action === 'unban'
  )
    return;
  if (!context.targetExists) {
    if (request.action === 'ban') return;
    throw new UserError('The target is not a current server member.');
  }
  if (request.targetId === context.ownerId)
    throw new UserError('This action cannot target the server owner.');
  if (manual && request.actorId !== context.ownerId && !context.actorAboveTarget)
    throw new UserError('The target has an equal or higher role than you.');
  if (request.action !== 'warn' && !context.botAboveTarget)
    throw new UserError('The target has an equal or higher role than the bot.');
  if (
    ['timeout', 'untimeout'].includes(request.action) &&
    (context.targetAdministrator || context.targetBot)
  )
    throw new UserError('Timeout actions cannot target administrators or bots.');
}
