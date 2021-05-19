const { prefix, defaultCooldown } = require('../../config.json');
const Discord = require(`discord.js`);

module.exports = {
	name: 'help',
	description: 'List all of my commands or info about a specific command.',
	aliases: ['commands'],
	cooldown: 5,
	usage: prefix + this.name + ` [command name]`,
	async execute(message, args, client) {
		const { commands } = message.client; //Importing the commands collection from Client

		if (!args.length) { //Checking if they provided user-input
			const data = [];
			const mainEmbed = new Discord.MessageEmbed()
				.setTitle(`Commands List`)
				.setFooter(client.user.username)
				.setDescription(`You can send \`${prefix}help [command name]\` to get info on a specific command!`);
			
			data.push(commands.map(command => command.name).join('\n')); //We map all the available commands
			mainEmbed.addField(`Commands`, `\`${data}\``);

			message.lineReplyNoMention(mainEmbed)
			return
		}
		
		const name = args[0].toLowerCase();
		const command = commands.get(name) || commands.find(c => c.aliases && c.aliases.includes(name));


		if (!command) { // We check if the argument provided is a valid command or alias
			return message.lineReply('Please provide a valid command.');
		}
		let commandEmbed = new Discord.MessageEmbed()
			.setTitle(`Command - ` + command.name)
			.setAuthor(client.user.username);

		if (command.description) commandEmbed.addField(`Description`, command.description);

		if (command.argument) commandEmbed.addField(`Usage`, '`' + prefix + command.name + ' ' + command.argument + '`');

		if (command.aliases) commandEmbed.addField(`Aliases`, `\`${command.aliases || `None`}\``); 

		commandEmbed.addField(`Cooldown`, `${command.cooldown || defaultCooldown} second(s)`);

		await message.lineReplyNoMention(commandEmbed);
	},
};