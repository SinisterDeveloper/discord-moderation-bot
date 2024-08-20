const { prefix } = require('../../config.json');
const EMBEDS = require(`../../Assets/Static/embeds`);
const ModlogSchema = require('../../Schemas/modlog');
const { updateModlog } = require('../../Assets/util');

module.exports = {
	name: 'unban',
	description: 'Unban a member from your server',
	cooldown: 3,
	category: "moderation",
	aliases: ['exile'],
	requireArgs: true,
	permission: `BAN_MEMBERS`,
	usage: `${prefix}unban <member> <reason?>`,
	async execute(message, args, client) {
		const toUnBan = message.mentions.members.first() || args[0];

		const reason = args.slice(1).join(' ') || 'No reason specified';

		try {
			let unBanned = await message.guild.bans.remove(toUnBan, reason);
			let punishNotificationChannel = EMBEDS.moderationCommands.punishNotificationChannel;
			punishNotificationChannel.setDescription(`**${unBanned.username}** has been unbanned for: ${reason}`);

			message.channel.send({ embeds: [punishNotificationChannel] });

			const date = new Date().toString();
			const modlogData = { Type: 'Unban', User: unBanned.id, Guild: message.guild.id, Moderator: message.member.id, Reason: reason, Date: date }
			const Modlog = new ModlogSchema(modlogData);

			Modlog.save()
				.then(() => updateModlog(client, unBanned.id, { server: message.guild.id, modlog: modlogData }))
				.catch(e => {
					console.error(e);
					return message.reply(`There was an error while saving modlog to the database:\n\`\`\`js\n${e.message}\`\`\``);
				});
		} catch (e) {
			console.log(e);
			message.channel.send({ content: `Unable to unban \`${toUnBan}\`\n\`\`\`js\n${e}\n\`\`\`` });
		}
	}
}