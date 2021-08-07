const { prefix } = require('../../config.json');
const EMBEDS = require(`../../assets/Static/embeds`);
const ModlogSchema = require('../../Schemas/modlog');

module.exports = {
	name: 'warn',
	description: 'Warns a member',
	cooldown: 3,
	aliases: [],
	permission: `KICK_MEMBERS`,
	usage: prefix + this.name,
	category: "moderation",
	requireArgs: true,
	async execute(message, args, client) {
		const date = new Date().toString();

		const toWarn = message.mentions.members.first() || await message.guild.members.fetch(args[0]);
		if (!toWarn) return message.channel.send({ content: `Unable to resolve GuildMember \`${args[0]}\`` });

		if (toWarn.roles.highest.position > message.guild.me.roles.highest.position) return message.channel.send(EMBEDS.moderationCommands.punishUserHigherBot);
		if (toWarn.roles.highest.position === message.guild.me.roles.highest.position) return message.channel.send(EMBEDS.moderationCommands.punishUserHigherBot);

		if (toWarn.roles.highest.position > message.member.roles.highest.position && message.guild.ownerId !== message.member.id)
			return message.channel.send({ embeds: [EMBEDS.moderationCommands.PunishUserHigher] });
		if (toWarn.roles.highest.position === message.member.roles.highest.position && message.guild.ownerId !== message.member.id)
			return message.channel.send({ embeds: [EMBEDS.moderationCommands.PunishUserHigher] });

		if (message.channel.permissionsFor(toWarn).has('ADMINISTRATOR')) return message.channel.send({ embeds: [EMBEDS.moderationCommands.isAdmin] });

		const reason = args.slice(1).join(' ') || 'No reason specified';

		let warnNotificationDM = EMBEDS.moderationCommands.punishNotificationDM;
		warnNotificationDM.setDescription(`You were warned in **${message.guild.name}** for: ${reason}`);

		let punishNotificationChannel = EMBEDS.moderationCommands.punishNotificationChannel;
		punishNotificationChannel.setDescription(`**${toWarn.user.tag}** has been warned for: ${reason}`);

		try {
			await toWarn.send({ embeds: [warnNotificationDM] });
		} catch {
			console.log(`Member has dms closed!`);
		} finally {
			message.channel.send({ embeds: [punishNotificationChannel] });
			const Modlog = new ModlogSchema({ Type: 'Warn', User: toWarn.id, Moderator: message.member.id, Reason: reason, Date: date });

			Modlog.save(async function(err) {
				if (err) {
					console.error(err);
					return message.reply(`There was an error while saving modlog to the database:\n\`\`\`js\n${err.message}\`\`\``);
				}
			});
		}

	},
};
