const { prefix } = require('../../config.json');
const miscEmbed = require('../../Assets/Static/embeds').miscellaneous;

module.exports = {
	name: 'help',
	description: 'Check the list of commands',
	cooldown: 3,
	aliases: ['commands'],
	category: "miscellaneous",
	permission: `SEND_MESSAGES`,
	usage: `${prefix}help {command?}`,
	async execute(message, args, client) {
		const { commands } = client;

		if (!args.length) {
			let moderation = [];
			let miscellaneous = [];
			let administration = [];

			const categoryMap = {
				moderation,
				miscellaneous,
				administration
			};

			commands.forEach(c => {
				if (categoryMap[c.category]) {
					categoryMap[c.category].push(`\`${c.name}\``);
				}
			});

			const helpEmbed = await miscEmbed.help(miscellaneous, moderation, administration);

			await message.reply({ embeds: [helpEmbed], allowedMentions: { repliedUser: false } });
		}
		else {
			const name = args[0].toLowerCase();
			const command = commands.get(name) || commands.find(c => c.aliases && c.aliases.includes(name));

			if (!command) {
				return message.reply({ content: 'Invalid command!' });
			}

			const helpEmbed = miscEmbed.sendUsage(command);
			await message.reply({ embeds: [helpEmbed], allowedMentions: { repliedUser: false } });
		}
	}
};
