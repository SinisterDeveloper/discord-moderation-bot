const { prefix } = require('../../config.json');
const { MessageEmbed } = require('discord.js');
const colors = require('../../Assets/Static/colors');

module.exports = {
	name: 'modlogs',
	description: "Check a user's modlogs",
	cooldown: 5,
	category: 'moderation',
	aliases: ['infractions', 'inf'],
	requireArgs: true,
	permission: `KICK_MEMBERS`,
	usage: `${prefix}modlogs <user>`,
	async execute(message, args, client) {
		let toCheck;
		try {
			toCheck =
				message.mentions.users.first() ||
				(await client.users.fetch(args[0], { cache: true }));

		} catch (e) {
			if (e.httpStatus === 404)
				return message.reply({
					content: `Unknown User: \`${toCheck}\``,
				});
			else
				return message.reply({
					content: `Error while fetching User: \`${e}\``,
				});
		}

		let docs = client.modlogs.get(toCheck.id);

		if (docs) docs = docs[message.guild.id];

		if (!docs || !docs.length)
			return message.reply({
				content: `No modlogs found for \`${toCheck.username}\``,
				allowedMentions: { repliedUser: false },
			});


		docs = docs.reverse();

		const modlogsEmbed = new MessageEmbed()
			.setTitle(`Modlogs for ${toCheck.username}`)
			.setTimestamp()
			.setColor(colors.accentColor);

		await message.channel.send({
			content:
				docs.length === 1 ?
					`1 result found:`
				:	`${docs.length} results found`,
		});

		let num = 1;
		for (const doc of docs) {
			const date = new Date(doc.Date);
			let moderator = await client.users.fetch(doc.Moderator);
			modlogsEmbed.addField(
				`**Type**: ${doc.Type}`,
				`**Moderator**: ${moderator.tag}\n**Reason:** ${doc.Reason}\n**Created at**: ${date.toDateString()}\n`,
			);
			num++;
		}

		await message.channel.send({ embeds: [modlogsEmbed] });
	},
};
