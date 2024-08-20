const { prefix } = require('../../config.json');
const EMBEDS = require(`../../Assets/Static/embeds`);
const ModlogSchema = require('../../Schemas/modlog');
const {updateModlog} = require("../../Assets/util");

module.exports = {
	name: 'warn',
	description: 'Warns a member',
	cooldown: 3,
	aliases: [],
	permission: `KICK_MEMBERS`,
	usage: `${prefix}warn <member> {reason?}`,
	category: "moderation",
	requireArgs: true,
	async execute(message, args, client) {
		const date = new Date().toString();

		const toWarn = message.mentions.members.first() || await message.guild.members.fetch(args[0]);
		if (!toWarn) return message.channel.send({ content: `Unable to resolve GuildMember \`${args[0]}\`` });

		if (toWarn.roles.highest.position >= message.member.roles.highest.position && message.guild.ownerId !== message.member.id)
			return message.channel.send({ embeds: [EMBEDS.moderationCommands.PunishUserHigher] });

		if (message.channel.permissionsFor(toWarn).has('ADMINISTRATOR'))
			return message.channel.send({ embeds: [EMBEDS.moderationCommands.isAdmin] });


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

			const modlogData = { Type: 'Warn', User: toWarn.id, Guild: message.guild.id, Moderator: message.member.id, Reason: reason, Date: date }
			const Modlog = new ModlogSchema(modlogData);

			Modlog.save()
				.then(() => updateModlog(client, toWarn.id, { server: message.guild.id, modlog: modlogData }))
				.catch(e => {
					console.error(e);
					return message.reply(`There was an error while saving modlog to the database:\n\`\`\`js\n${e.message}\`\`\``);
				})
		}

	},
};
