const { prefix } = require('../../config.json');
const EMBEDS = require(`../../assets/Static/embeds`);

module.exports = {
	name: 'unmute',
	description: 'Unmutes a muted member',
	cooldown: 3,
	aliases: [],
	permission: `KICK_MEMBERS`,
	usage: prefix + this.name,
	requireArgs: true,
	category: "moderation",
	async execute(message, args, client, pool) {
		const db = pool.db("Bot");
		const date = new Date().toString();

		const toUnmute = message.mentions.members.first() || await message.guild.members.fetch(args[0]);
		if (!toUnmute) return message.channel.send({ content: `Unable to resolve GuildMember \`${args[0]}\`` });

		const reason = args.slice(1).join(' ') || 'No reason specified';

		let mutedRole = toUnmute.roles.cache.find(r => r.name.toLowerCase() === "muted");

		let punishNotificationChannel = EMBEDS.moderationCommands.punishNotificationChannel;
		punishNotificationChannel.setDescription(`**${toUnmute.user.tag}** has been unmuted for: ${reason}`);

		try {
			await toUnmute.roles.remove(mutedRole, `Member was unmuted`);
			message.channel.send({ embeds: [punishNotificationChannel] })
			await db
				.collection("Modlogs")
				.insertOne({
					Type: "Unmute",
					User: toUnmute.id,
					Moderator: message.member.id,
					Reason: reason,
					Date: date
				}, function (err) {
					if (err) throw err;
				});
		} catch (error) {
			message.channel.send({ content: `Error occurred:\n \`\`\`js\n${error.message}${error.stack.substr(0, 500)}\`\`\`` })
		}
	}
}
