const { prefix } = require('../../config.json');
const EMBEDS = require(`../../assets/Static/embeds`);
const ModlogSchema = require('../../Schemas/modlog');
const MuteRoleSchema = require('../../Schemas/muterole');

module.exports = {
	name: 'unmute',
	description: 'Unmutes a muted member',
	cooldown: 3,
	aliases: [],
	permission: `KICK_MEMBERS`,
	usage: prefix + this.name,
	requireArgs: true,
	category: "moderation",
	async execute(message, args, client) {
		const date = new Date().toString();

		const toUnmute = message.mentions.members.first() || await message.guild.members.fetch(args[0]);
		if (!toUnmute) return message.channel.send({ content: `Unable to resolve GuildMember \`${args[0]}\`` });

		const reason = args.slice(1).join(' ') || 'No reason specified';

		let muteRole = await MuteRoleSchema.findOne({ GuildID: message.guild.id });

		if (!muteRole) return message.reply({ content: 'This guild does not have a mute role setup!' });

		let punishNotificationChannel = EMBEDS.moderationCommands.punishNotificationChannel;
		punishNotificationChannel.setDescription(`**${toUnmute.user.tag}** has been unmuted for: ${reason}`);

		try {
			await toUnmute.roles.remove([muteRole.RoleID], `Member was unmuted`);
			message.channel.send({ embeds: [punishNotificationChannel] });
			new ModlogSchema({ Type: 'Unmute', User: toUnmute.id, Moderator: message.member.id, Reason: reason, Date: date })
				.save(function(err) {
					if (err) {
						console.error(err);
						return message.reply(`There was an error while saving modlog to the database:\n\`\`\`js\n${err.message}\`\`\``);
					}
				});
		} catch (error) {
			console.log(error);
			message.channel.send({ content: `Error occurred:\n \`\`\`js\n${error.message}${error.stack.substr(0, 500)}\`\`\`` });
		}
	}
};
