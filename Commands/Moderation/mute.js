const { prefix } = require('../../config.json');
const EMBEDS = require(`../../assets/Static/embeds`);

module.exports = {
	name: 'mute',
	description: 'Mute members from talking',
	cooldown: 3,
	aliases: ['jail'],
	permission: `KICK_MEMBERS`,
	usage: prefix + this.name,
	requireArgs: true,
	category: "moderation",
	async execute(message, args, client, pool) {
		const db = pool.db("Bot");
		const date = new Date().toString();

		const toMute = message.mentions.members.first() || await message.guild.members.fetch(args[0]);
		if (!toMute) return message.channel.send({ content: `Unable to resolve GuildMember \`${args[0]}\`` });

		if (toMute.roles.highest.position > message.guild.me.roles.highest.position)  return message.channel.send(EMBEDS.moderationCommands.punishUserHigherBot);
		if (toMute.roles.highest.position === message.guild.me.roles.highest.position)  return message.channel.send(EMBEDS.moderationCommands.punishUserHigherBot);

		if (toMute.roles.highest.position > message.member.roles.highest.position)
			return message.channel.send(EMBEDS.moderationCommands.PunishUserHigher);
		if (toMute.roles.highest.position === message.member.roles.highest.position)
			return message.channel.send(EMBEDS.moderationCommands.PunishUserHigher);

		if (message.channel.permissionsFor(toMute).has('ADMINISTRATOR')) return message.channel.send({ embeds: [EMBEDS.moderationCommands.isAdmin] });

		const reason = args.slice(1).join(' ') || 'No reason specified';

		let muteNotificationDM = EMBEDS.moderationCommands.punishNotificationDM;
		muteNotificationDM.setDescription(`You were muted in **${message.guild.name}** for: ${reason}`);

		let punishNotificationChannel = EMBEDS.moderationCommands.punishNotificationChannel;
		punishNotificationChannel.setDescription(`**${toMute.user.tag}** has been muted for: ${reason}`);

		await db
			.collection("MutedRole")
			.findOne({
				GuildID: message.guild.id
			}, async function (err, res) {
				if (!res || !res.RoleID) {
					let mutedRole = await message.guild.roles.create({ name: "Muted", reason: "Creating new role to mute users" });
					await toMute.roles.add(mutedRole);
					await message.guild.channels.cache.forEach(c => {
						c.permissionOverwrites.edit(mutedRole, {
							'SEND_MESSAGES': false,
							'EMBED_LINKS': false,
							'ATTACH_FILES': false,
							'ADD_REACTIONS': false,
							'CONNECT': false,
							'SPEAK': false,
						});
					});
					await message.channel.send({ embeds: [punishNotificationChannel] });
					await toMute.send({ embeds: [muteNotificationDM] });

					await db
						.collection("MutedRole")
						.insertOne({
							GuildID: message.guild.id,
							RoleID: mutedRole.id
						}, function (err, res) {
							if (err) throw err;
						});
					await db
						.collection("Modlogs")
						.insertOne({
							Type: "Mute",
							User: toMute.id,
							Moderator: message.member.id,
							Reason: reason,
							Date: date
						}, function (err) {
							if (err) throw err;
						});
				} else {
					let mutedRole = await message.guild.roles.fetch(res.RoleID);
					await toMute.roles.add(mutedRole);
					await message.channel.send({ embeds: [punishNotificationChannel] });
					await toMute.send({ embeds: [muteNotificationDM] });
					await db
						.collection("Modlogs")
						.insertOne({
							Type: "Mute",
							User: toMute.id,
							Moderator: message.member.id,
							Reason: reason,
							Date: date
						}, function (err, res) {
							if (err) throw err;
						});
				}
			})
	}
}
