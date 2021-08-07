const { prefix } = require('../../config.json');
const { MessageEmbed } = require('discord.js');
const colors = require('../../Assets/Static/colors');
const ModlogSchema = require('../../Schemas/modlog');

module.exports = {
	name: 'modlogs',
	description: 'Check a user\'s modlogs',
	cooldown: 5,
	category: "moderation",
	aliases: ['infractions', 'inf'],
	requireArgs: true,
	permission: `KICK_MEMBERS`,
	usage: `${prefix}modlogs <user>`,
	async execute(message, args, client, pool) {
		const toCheck = message.mentions.users.first() || await client.users.fetch(args[0]);

		if (!toCheck) return message.reply({ content: `Unable to fetch User \`${toCheck}\`` });

		let doc = await ModlogSchema.find({ User: toCheck.id });

		if (!doc || !doc.length) return message.reply({ content: `No modlogs found for \`${toCheck.tag}\``, allowedMentions: { repliedUser: false } });

		doc = doc.reverse();
		
		const modlogsEmbed = new MessageEmbed()
			.setTitle(`Modlogs for ${toCheck.tag}`)
			.setTimestamp()
			.setColor(colors.accentColor);

		await message.channel.send({ content: doc.length === 1 ? `1 result found:` : `${doc.length} results found` });

		await doc.forEach(async res => {
			const date = new Date(res.Date);
			let moderator = await client.users.fetch(res.Moderator);
			modlogsEmbed.addField(`Case Id: ${res._id.toString()}`, `**Type**: ${res.Type}\n**Moderator**: ${moderator.tag}\n**Reason:** ${res.Reason}\n**Created at**: ${date.toDateString()}`);
		});

		await message.channel.send({ embeds: [modlogsEmbed] });
	},
};
