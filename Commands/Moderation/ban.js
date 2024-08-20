const { prefix } = require('../../config.json');
const EMBEDS = require(`../../Assets/Static/embeds`);
const ModlogSchema = require('../../Schemas/modlog');
const { updateModlog } = require('../../Assets/util');

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
		let toBan;
		try {
			toBan = message.mentions.members.first() || await message.guild.members.fetch(args[0]);
		} catch {
			return message.channel.send({ content: `Unable to resolve GuildMember \`${args[0]}\`. User might not be present in the server.` });
		}

		if (!toBan.bannable)
			return message.channel.send({ embeds: [EMBEDS.moderationCommands.punishUserHigherBot] });

		if (toBan.roles.highest.position >= message.member.roles.highest.position && message.guild.ownerId !== message.member.id)
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
			await toBan.ban({ reason: reason });
			message.channel.send({ embeds: [punishNotificationChannel] });
			const date = new Date().toString();
			const modlogData = { Type: 'Ban', User: toBan.id, Guild: message.guild.id, Moderator: message.member.id, Reason: reason, Date: date }
			const Modlog = new ModlogSchema(modlogData);

			Modlog.save()
				.then(() => updateModlog(client, toBan.id, { server: message.guild.id, modlog: modlogData }))
				.catch(e => {
					console.error(e);
					return message.reply(`There was an error while saving modlog to the database:\n\`\`\`js\n${e.message}\`\`\``);
				});
		}
	}
};
