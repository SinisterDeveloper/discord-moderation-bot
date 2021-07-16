const { prefix } = require('../../config.json');
const EMBEDS = require(`../../assets/Static/embeds`);

module.exports = {
	name: 'ban',
	description: 'Ban members from your server',
	cooldown: 3,
	aliases: ['ipban'],
	permission: `SEND_MESSAGES`,
	usage: prefix + this.name,
	async execute(message, args, client) {
		const toBan = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
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
		}
	}
}
