const { prefix } = require('../../config.json');
const EMBEDS = require(`../../Assets/Static/embeds`);
const ModlogSchema = require('../../Schemas/modlog');
const { updateModlog } = require("../../Assets/util");

module.exports = {
	name: 'kick',
	description: 'Kick a member from the server',
	cooldown: 3,
	category: "moderation",
	aliases: [],
	permission: `KICK_MEMBERS`,
	usage: `${prefix}kick <member> {reason?}`,
	requireArgs: true,
	async execute(message, args, client) {
		const toKick = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
		if (!toKick) return message.channel.send({ content: `Unable to resolve GuildMember \`${args[0]}\`` });

		if (!toKick.kickable)
			return message.channel.send({ embeds: [EMBEDS.moderationCommands.punishUserHigherBot] });

		if (toKick.roles.highest.position >= message.member.roles.highest.position && message.guild.ownerId !== message.member.id)
			return message.channel.send({ embeds: [EMBEDS.moderationCommands.PunishUserHigher] });

		const reason = args.slice(1).join(' ') || 'No reason specified';

		let banNotificationDM = EMBEDS.moderationCommands.punishNotificationDM;
		banNotificationDM.setDescription(`You were kicked from **${message.guild.name}** for: ${reason}`);

		let punishNotificationChannel = EMBEDS.moderationCommands.punishNotificationChannel;
		punishNotificationChannel.setDescription(`**${toKick.user.tag}** has been kicked for: ${reason}`);

		try {
			await toKick.send({ embeds: [banNotificationDM] });
		} catch (err) {
			console.log('User has dms closed!');
		} finally {
			await toKick.kick(reason);
			await message.channel.send({ embeds: [punishNotificationChannel] });

			const date = new Date().toString();
			const modlogData = { Type: 'Kick', User: toKick.id, Guild: message.guild.id, Moderator: message.member.id, Reason: reason, Date: date }
			const Modlog = new ModlogSchema(modlogData);

			Modlog.save()
				.then(() => updateModlog(client, toKick.id, { server: message.guild.id, modlog: modlogData }))
				.catch(e => {
					console.error(e);
					return message.reply(`There was an error while saving modlog to the database:\n\`\`\`js\n${e.message}\`\`\``);
				})
		}
	}
};
