const { prefix } = require('../../config.json');
const EMBEDS = require(`../../assets/Static/embeds`);
const ModlogSchema = require('../../Schemas/modlog');

module.exports = {
	name: 'kick',
	description: 'Kick a member from the server',
	cooldown: 3,
	category: "moderation",
	aliases: [],
	permission: `KICK_MEMBERS`,
	usage: prefix + this.name,
	requireArgs: true,
	async execute(message, args) {
		const toKick = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
		if (!toKick) return message.channel.send({ content: `Unable to resolve GuildMember \`${args[0]}\`` });

		if (toKick.roles.highest.position > message.guild.me.roles.highest.position) return message.channel.send(EMBEDS.moderationCommands.punishUserHigherBot);
		if (toKick.roles.highest.position === message.guild.me.roles.highest.position) return message.channel.send(EMBEDS.moderationCommands.punishUserHigherBot);

		if (toKick.roles.highest.position > message.member.roles.highest.position && message.guild.ownerId !== message.member.id)
			return message.channel.send(EMBEDS.moderationCommands.PunishUserHigher);
		if (toKick.roles.highest.position === message.member.roles.highest.position && message.guild.ownerId !== message.member.id)
			return message.channel.send(EMBEDS.moderationCommands.PunishUserHigher);

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
			const Modlog = new ModlogSchema({ Type: 'Kick', User: toKick.id, Moderator: message.member.id, Reason: reason, Date: date });

			Modlog.save(async function(err) {
				if (err) {
					console.error(err);
					return message.reply(`There was an error while saving modlog to the database:\n\`\`\`js\n${err.message}\`\`\``);
				}
			});
		}
	}
};
