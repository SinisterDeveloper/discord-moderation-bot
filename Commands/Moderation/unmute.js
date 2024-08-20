const { prefix } = require('../../config.json');
const EMBEDS = require(`../../Assets/Static/embeds`);
const ModlogSchema = require('../../Schemas/modlog');
const { updateModlog} = require("../../Assets/util");

module.exports = {
	name: 'unmute',
	description: 'Unmutes a muted member',
	cooldown: 3,
	aliases: [],
	permission: `KICK_MEMBERS`,
	usage: `${prefix}unmute <member>`,
	requireArgs: true,
	category: "moderation",
	async execute(message, args, client) {
		const date = new Date().toString();

		const toUnmute = message.mentions.members.first() || await message.guild.members.fetch(args[0]);
		if (!toUnmute) return message.channel.send({ content: `Unable to resolve GuildMember \`${args[0]}\`` });

		const reason = args.slice(1).join(' ') || 'No reason specified';

		let muteRole = client.muteRoles.get(message.guild.id);

		if (!muteRole) return message.reply({ content: 'This guild does not have a mute role setup!' });

		let punishNotificationChannel = EMBEDS.moderationCommands.punishNotificationChannel;
		punishNotificationChannel.setDescription(`**${toUnmute.user.tag}** has been unmuted for: ${reason}`);

		try {
			await toUnmute.roles.remove([muteRole.RoleID], `Member was unmuted`);
			message.channel.send({ embeds: [punishNotificationChannel] });
		} catch (error) {
			console.log(error);
			message.channel.send({ content: `Error occurred:\n \`\`\`js\n${error.message}${error.stack.substr(0, 500)}\`\`\`` });
		} finally {
			const modlogData = { Type: 'Unmute', User: toUnmute.id, Guild: message.guild.id, Moderator: message.member.id, Reason: reason, Date: date }
			const Modlog = new ModlogSchema(modlogData);

			Modlog.save()
				.then(() => updateModlog(client, toUnmute.id, { server: message.guild.id, modlog: modlogData }))
				.catch(e => {
					console.error(e);
					return message.reply(`There was an error while saving modlog to the database:\n\`\`\`js\n${e.message}\`\`\``);
				})
		}
	}
};
