const { prefix } = require('../../config.json');
const SettingsSchema = require('../../Schemas/settings');

module.exports = {
	name: 'minage',
	description: 'Sets the minimum account age to join server',
	cooldown: 3,
	category: 'administration',
	aliases: [],
	requireArgs: true,
	permission: `ADMINISTRATOR`,
	usage: `${prefix}minage <days>`,
	async execute(message, args, client) {
		if (!args[0] || !parseInt(args[0]))
			return message.reply(
				'Please provide the number of days as an Integer',
			);
		try {
			await SettingsSchema.findOneAndUpdate(
				{ GuildID: message.guild.id },
				{ MinimumAge: args[0] },
				{ upsert: true },
			);
			message.channel.send(
				`Successfully updated Minimum Account Age Requirement to \`${args[0]}\` days`,
			);
			client.minage.set(message.guild.id, args[0]);
		} catch (e) {
			console.log(e);
			return message.reply(`Error:\n\`\`\`js\n${e.message}\`\`\``);
		}
	},
};
