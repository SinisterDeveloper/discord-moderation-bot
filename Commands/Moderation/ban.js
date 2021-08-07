const { prefix } = require('../../config.json');
const EMBEDS = require(`../../assets/Static/embeds`);
const ModlogSchema = require('../../Schemas/modlog');

module.exports = {
	name: 'ban',
	description: 'Ban members from your server',
	cooldown: 3,
	category: "moderation",
	aliases: ['exile'],
	requireArgs: true,
	permission: `BAN_MEMBERS`,
	usage: `${prefix}ban <member> <reason>`,
	async execute(message, args, client) {
		const toBan = message.mentions.members.first() || await message.guild.members.fetch(args[0]);

		if (!toBan) return message.channel.send({ content: `Unable to resolve GuildMember \`${args[0]}\`` });

		if (toBan.roles.highest.position > message.guild.me.roles.highest.position) return message.channel.send({ embeds: [EMBEDS.moderationCommands.punishUserHigherBot] });
		if (toBan.roles.highest.position === message.guild.me.roles.highest.position) return message.channel.send({ embeds: [EMBEDS.moderationCommands.punishUserHigherBot] });

		if (toBan.roles.highest.position > message.member.roles.highest.position && message.guild.ownerId !== message.member.id)
			return message.channel.send({ embeds: [EMBEDS.moderationCommands.PunishUserHigher] });
		if (toBan.roles.highest.position === message.member.roles.highest.position && message.guild.ownerId !== message.member.id)
			return message.channel.send({ embeds: [EMBEDS.moderationCommands.PunishUserHigher] });

		const reason = args.slice(1).join(' ') || 'No reason specified';

		let banNotificationDM = EMBEDS.moderationCommands.punishNotificationDM;
		banNotificationDM.setDescription(`You were banned from **${message.guild.name}** for: ${reason}`);

		let punishNotificationChannel = EMBEDS.moderationCommands.punishNotificationChannel;
		punishNotificationChannel.setDescription(`**${toBan.user.tag}** has been banned for: ${reason}`);

		try {
			await toBan.send({ embeds: [banNotificationDM] });
		} catch (err) {
			console.log(`${toBan.user.tag} has Dms closed!`);
		} finally {
			await toBan.ban({
				days: 7,
				reason: reason
			});
			message.channel.send({ embeds: [punishNotificationChannel] });
			const date = new Date().toString();
			const Modlog = new ModlogSchema({ Type: 'Ban', User: toBan.id, Moderator: message.member.id, Reason: reason, Date: date });

			Modlog.save(async function(err) {
				if (err) {
					console.error(err);
					return message.reply(`There was an error while saving modlog to the database:\n\`\`\`js\n${err.message}\`\`\``);
				}
			});
		}
	}
};
