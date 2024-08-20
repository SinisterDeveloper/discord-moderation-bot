const fs = require('fs');
const { Client, Collection, Intents } = require('discord.js');
const mongoose = require('mongoose');
const { prefix, token, defaultCooldown, MongoConnectionUrl } = require('./config.json');
const { miscellaneous }= require('./Assets/Static/embeds');
const Modlogs = require('./Schemas/modlog');
const MuteRole = require('./Schemas/muterole');
const { updateModlog } = require('./Assets/util');

async function connect() {
	mongoose
		.connect(MongoConnectionUrl, {
			dbName: 'moderation-bot',
		})
		.then(async () => {
			console.log('Established connection with Database');
            await fetchData();
			console.log('Successfully fetched data from the database');
		})
		.catch((error) => console.error(error));

	client.login(token)
		.then(() => console.log(`Token authenticated!`));
}

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_BANS], allowedMentions: { repliedUser: true } });

client.commands = new Map();
client.cooldowns = new Map();
client.modlogs = new Map();
client.muteRoles = new Map();

// Events
const eventFiles = fs.readdirSync('./Events').filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
	const event = require(`./Events/${file}`);
	if (event.once) {
		client.once(event.name, async (...args) => await event.execute(...args));
	} else {
		client.on(event.name, async (...args) => await event.execute(...args));
	}
}

const commandFolders = fs.readdirSync('./Commands');
for (const folder of commandFolders) {
	const commandFiles = fs.readdirSync(`./Commands/${folder}`).filter(file => file.endsWith('.js'));
	for (const file of commandFiles) {
		const command = require(`./Commands/${folder}/${file}`);
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
		cooldowns.set(command.name, new Map());
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

async function fetchData() {
    const modlogs = await Modlogs.find({});
	for (const modlog of modlogs)
		updateModlog(client, modlog.User, { server: modlog.Guild, modlog: modlog });

    const muteRoles = await MuteRole.find({});
	for (const muteRole of muteRoles)
        client.muteRoles.set(muteRole.GuildID, muteRole.RoleID);
}

process.on('unhandledRejection', error => {
	console.error('Unhandled promise rejection:', error);
});

connect().catch((e) => console.error(e));
