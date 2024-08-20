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
	async execute(message, args, client) {
		const toCheck = message.mentions.users.first() || await client.users.fetch(args[0]);

		if (!toCheck) return message.reply({ content: `Unable to fetch User \`${toCheck}\`` });

		let docs = client.modlogs.get(toCheck.id)[message.guild.id];

		if (!docs || !docs.length) return message.reply({ content: `No modlogs found for \`${toCheck.tag}\``, allowedMentions: { repliedUser: false } });

		docs = docs.reverse();
		
		const modlogsEmbed = new MessageEmbed()
			.setTitle(`Modlogs for ${toCheck.tag}`)
			.setTimestamp()
			.setColor(colors.accentColor);

		await message.channel.send({ content: docs.length === 1 ? `1 result found:` : `${docs.length} results found` });

		let num = 1;
		for (const doc of docs) {
			const date = new Date(doc.Date);
			let moderator = await client.users.fetch(doc.Moderator);
			modlogsEmbed.addField(`${num}) Case Id: ${doc._id.toString()}`, `**Type**: ${doc.Type}\n**Moderator**: ${moderator.tag}\n**Reason:** ${doc.Reason}\n**Created at**: ${date.toDateString()}\n`);
			num++;
		}

		await message.channel.send({ embeds: [modlogsEmbed] });
	},
};
