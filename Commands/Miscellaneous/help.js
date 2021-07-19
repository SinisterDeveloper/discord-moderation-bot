const { prefix } = require('../../config.json');
const { miscellaneous }= require('../../Assets/Static/embeds');

module.exports = {
	name: 'help',
	description: 'Check the list of commands',
	cooldown: 3,
	aliases: ['commands'],
	category: "miscellaneous",
	permission: `SEND_MESSAGES`,
	usage: prefix + this.name,
	async execute(message, args, client) {
		const { commands } = client;

		if (!args.length) {
			const modCommands = [];
			const miscCommands = [];

			commands.forEach(c => {
				if (c.category === "miscellaneous") miscCommands.push(c.name);
			})
			commands.forEach(c => {
				if (c.category === "moderation") modCommands.push(c.name);
			})

			const helpEmbed = await miscellaneous.help(miscCommands, modCommands);

			await message.reply({ embeds: [helpEmbed], allowedMentions: { repliedUser: false } });
		}
		else {
			const name = args[0].toLowerCase();
			const command = commands.get(name) || commands.find(c => c.aliases && c.aliases.includes(name));

			if (!command) {
				return message.reply({ content: 'Invalid command!' });
			}

			const helpEmbed = await miscellaneous.sendUsage(command);
			await message.reply({ embeds: [helpEmbed], allowedMentions: { repliedUser: false } });
		}
	}
}
