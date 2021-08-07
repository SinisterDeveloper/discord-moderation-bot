const fs = require('fs');
const { Client, Collection, Intents } = require('discord.js');
const mongoose = require('mongoose');
const { prefix, token, defaultCooldown, MongoConnectionUrl } = require('./config.json');
const { miscellaneous }= require('./Assets/Static/embeds');

// Database Connection
mongoose.connect(MongoConnectionUrl, { useUnifiedTopology: true, useNewUrlParser: true, useFindAndModify: false })
	.then(() => console.log('Connected to Database.'))
	.catch((error) => console.log(error));

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_BANS], allowedMentions: { repliedUser: true } });

client.commands = new Collection();
client.cooldowns = new Collection();

// Events
const eventFiles = fs.readdirSync('./events').filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
	const event = require(`./events/${file}`);
	if (event.once) {
		client.once(event.name, async (...args) => await event.execute(...args, client));
	} else {
		client.on(event.name, async (...args) => await event.execute(...args, client));
	}
}

const commandFolders = fs.readdirSync('./commands');
for (const folder of commandFolders) {
	const commandFiles = fs.readdirSync(`./commands/${folder}`).filter(file => file.endsWith('.js'));
	for (const file of commandFiles) {
		const command = require(`./commands/${folder}/${file}`);
		client.commands.set(command.name, command);
	}
}

// Command Handler
client.on('messageCreate', async message => {
	if (!message.content.startsWith(prefix) || message.author.bot || !message.guild) return;

	const args = message.content
		.slice(prefix.length)
		.trim()
		.split(/ +/);

	const commandName = args.shift().toLowerCase();

	const command = client.commands.get(commandName) || client.commands.find(cmd => cmd.aliases && cmd.aliases.includes(commandName));

	if (!command) return;

	if (command.requireArgs) {
		const usageEmbed = await miscellaneous.sendUsage(command);
		if (!args.length) return message.reply({ embeds: [usageEmbed] });
	}

	let permissions = message.channel.permissionsFor(message.member);

	if (!permissions || !permissions.has(command.permission)) return message.reply({ content: 'You do not have permission to use this command!' });

	const { cooldowns } = client;

	if (!cooldowns.has(command.name)) {
		cooldowns.set(command.name, new Collection());
	}

	const now = Date.now();
	const timestamps = cooldowns.get(command.name);
	const cooldownAmount = (command.cooldown || defaultCooldown) * 1000; // Default cooldown time would be 1 second

	if (timestamps.has(message.author.id)) {
		const expirationTime = timestamps.get(message.author.id) + cooldownAmount;

		if (now < expirationTime) {
			const timeLeft = (expirationTime - now) / 1000;
			return message.reply(`Please wait ${timeLeft.toFixed(1)} more second(s) before reusing the \`${command.name}\` command.`);
		}
	}

	timestamps.set(message.author.id, now);
	setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);

	try {
		command.execute(message, args, client);
	} catch (error) {
		console.error(error);
		await message.channel.send(`Error occurred while executing the command! \n**Error:**\n\`\`\`js\n${error.message}${error.stack.substr(0, 800)}\`\`\``);
	}
});

process.on('unhandledRejection', error => {
	console.error('Unhandled promise rejection:', error);
});

client.login(token)
	.then(() => console.log(`Valid token..`));
