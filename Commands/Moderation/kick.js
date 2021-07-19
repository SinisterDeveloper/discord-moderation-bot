const { prefix } = require('../../config.json');
const EMBEDS = require(`../../assets/Static/embeds`);

module.exports = {
	name: 'kick',
	description: 'Check the bot latency',
	cooldown: 3,
	category: "moderation",
	aliases: [],
	permission: `KICK_MEMBERS`,
	usage: prefix + this.name,
	requireArgs: true,
	async execute(message, args, client) {
		const toKick = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
		if (!toKick) return message.channel.send({ content: `Unable to resolve GuildMember \`${args[0]}\`` });

		if (toKick.roles.highest.position > message.guild.me.roles.highest.position)  return message.channel.send(EMBEDS.moderationCommands.punishUserHigherBot);
		if (toKick.roles.highest.position === message.guild.me.roles.highest.position)  return message.channel.send(EMBEDS.moderationCommands.punishUserHigherBot);

		if (toKick.roles.highest.position > message.member.roles.highest.position)
			return message.channel.send(EMBEDS.moderationCommands.PunishUserHigher);
		if (toKick.roles.highest.position === message.member.roles.highest.position)
			return message.channel.send(EMBEDS.moderationCommands.PunishUserHigher);

		const reason = args.slice(1).join(' ') || 'No reason specified';

		let banNotificationDM = EMBEDS.moderationCommands.punishNotificationDM;
		banNotificationDM.setDescription(`You were kicked from **${message.guild.name}** for: ${reason}`);

		let punishNotificationChannel = EMBEDS.moderationCommands.punishNotificationChannel;
		punishNotificationChannel.setDescription(`**${toKick.user.tag}** has been banned for: ${reason}`);

		try {
			await toKick.send({ embeds: [banNotificationDM] });
		} catch (err) {
			console.log('User has dms closed!');
		} finally {
			await toKick.kick(reason);
			await message.channel.send({ embeds: [punishNotificationChannel] })
		}
	}
}
