const { prefix } = require('../../config.json');
const EMBEDS = require(`../../assets/Static/embeds`);

module.exports = {
	name: 'ban',
	description: 'Ban members from your server',
	cooldown: 3,
	category: "moderation",
	aliases: ['exile'],
	requireArgs: true,
	permission: `BAN_MEMBERS`,
	usage: `${prefix}ban <member> <reason>`,
	async execute(message, args, client, pool) {
		const db = pool.db("Bot");
		const toBan = message.mentions.members.first() || await message.guild.members.fetch(args[0]);
		if (!toBan) return message.channel.send({ content: `Unable to resolve GuildMember \`${args[0]}\`` });

		if (toBan.roles.highest.position > message.guild.me.roles.highest.position)  return message.channel.send(EMBEDS.moderationCommands.punishUserHigherBot);
		if (toBan.roles.highest.position === message.guild.me.roles.highest.position)  return message.channel.send(EMBEDS.moderationCommands.punishUserHigherBot);

		if (toBan.roles.highest.position > message.member.roles.highest.position)
			return message.channel.send(EMBEDS.moderationCommands.PunishUserHigher);
		if (toBan.roles.highest.position === message.member.roles.highest.position)
			return message.channel.send(EMBEDS.moderationCommands.PunishUserHigher);

		const reason = args.slice(1).join(' ') || 'No reason specified';

		let banNotificationDM = EMBEDS.moderationCommands.punishNotificationDM;
		banNotificationDM.setDescription(`You were banned from **${message.guild.name}** for: ${reason}`);

		let punishNotificationChannel = EMBEDS.moderationCommands.punishNotificationChannel;
		punishNotificationChannel.setDescription(`**${toBan.user.tag}** has been banned for: ${reason}`);

		try {
			await toBan.send({ embeds: [banNotificationDM] });
		} catch (err) {
			console.log(`${toBan.user.tag} has Dms closed!`)
		} finally {
			await toBan.ban({
				days: 7,
				reason: reason
			});
			message.channel.send({ embeds: [punishNotificationChannel] });
			const date = new Date().toString();
			await db
				.collection("Modlogs")
				.insertOne({
					Type: "Ban",
					User: toBan.id,
					Moderator: message.member.id,
					Reason: reason,
					Date: date
				}, function (err, res) {
					if (err) throw err;
				});
		}
	}
}
