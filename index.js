const fs = require('fs');
const Discord = require('discord.js');
const { prefix, token, defaultCooldown } = require('./config.json');

const client = new Discord.Client();
require(`discord-reply`);
client.commands = new Discord.Collection();
client.cooldowns = new Discord.Collection();

//Events
const eventFiles = fs.readdirSync('./events').filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
    const event = require(`./events/${file}`);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}


//Commands
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.name, command);
}
const commandFolders = fs.readdirSync('./commands');
for (const folder of commandFolders) {
    const commandFiles = fs.readdirSync(`./commands/${folder}`).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const command = require(`./commands/${folder}/${file}`);
        client.commands.set(command.name, command);
    }
}

//Command Handler
client.on('message', message => {
    if (!message.content.startsWith(prefix) || message.author.bot) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = client.commands.get(commandName)
        || client.commands.find(cmd => cmd.aliases && cmd.aliases.includes(commandName));
    if (!command) return;
    if (message.channel.type === 'dm') return
    if (!message.member.hasPermission(command.permission) && message.author.id !== "778140362790404158") {
        let MissingPerm = new Discord.MessageEmbed()
            .setColor("#000000")
            .setTitle("Permissions missing!")
            .setDescription(`You don't have the permissions to use this command. Only users with the \`${command.permission}\` permission can use the command!`)
            .setFooter("Darke");

        return message.channel.send(MissingPerm);
    }
    //Spam is something you generally want to avoid–especially if one of your commands requires calls to other APIs or takes a bit of time to build/send.
    
    const { cooldowns } = client;

    if (!cooldowns.has(command.name)) {
        cooldowns.set(command.name, new Discord.Collection());
    }

    const now = Date.now();
    const timestamps = cooldowns.get(command.name);
    const cooldownAmount = (command.cooldown || defaultCooldown) * 1000; //Default cooldown time would be 1 second

    if (timestamps.has(message.author.id)) {
        const expirationTime = timestamps.get(message.author.id) + cooldownAmount;

        if (now < expirationTime) {
            const timeLeft = (expirationTime - now) / 1000;
            return message.reply(`please wait ${timeLeft.toFixed(1)} more second(s) before reusing the \`${command.name}\` command.`);
        }
    }
    //If the author has already used this command in this session, get the timestamp, calculate the expiration time and inform the user of the amount of time they need to wait before using this command again.
    timestamps.set(message.author.id, now);
    setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);

    try {
        command.execute(message, args, client);
    } catch (error) {
        console.error(error);
        message.channel.send(`Error occurred while executing the command! \n**Error:**\n\`${error.message}\``);
    } //End Of Command Setup
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

client.login(token).then(() => console.log(`Token entered!`));