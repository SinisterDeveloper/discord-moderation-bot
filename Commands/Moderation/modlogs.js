const { prefix } = require('../../config.json');
const { MessageEmbed } = require('discord.js');
const colors = require('../../Assets/Static/colors');

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
		const db = pool.db("Bot");

		const toCheck = message.mentions.users.first() || await client.users.fetch(args[0]);

		try {
			await db
				.collection("Modlogs")
				.find({
					User: toCheck.id
				})
				.toArray(async function (err, result) {
					if (err) throw err;

					if (!result.length) return message.channel.send(`No modlogs found for \`${toCheck.tag}\``);

					const modlogsEmbed = new MessageEmbed()
						.setTitle(`Modlogs for ${toCheck.tag}`)
						.setTimestamp()
						.setColor(colors.accentColor);

					await message.channel.send({ content: result.length === 1 ? `1 result found` : `${result.length} results found` });

					await result.forEach(async res => {
						const date = new Date(res.Date);
						let moderator = await client.users.fetch(res.Moderator);
						modlogsEmbed.addField(`Case Id: ${res._id.toString()}`, `**Type**: ${res.Type}\n**Moderator**: ${moderator.tag}\n**Reason:** ${res.Reason}\n**Created at**: ${date.toDateString()}`)
					});

					await message.channel.send({ embeds: [modlogsEmbed] });
				})
		} catch (err) {
			message.channel.send({ content: err.message });
		}
	}
}
