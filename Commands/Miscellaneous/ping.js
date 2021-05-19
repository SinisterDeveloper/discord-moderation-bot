const Discord = require("discord.js")
const { prefix } = require('../../config.json');

module.exports = {
    name: 'ping',
    description: 'Ping!',
    guildOnly: false,
    cooldown: 3,
    permission: `SEND_MESSAGES`,
    usage: prefix + this.name,
    async execute(message, args) {
        await message.channel.send('Pong!').then(resultMessage => {
            const ping = resultMessage.createdTimestamp - message.createdTimestamp
            resultMessage.edit(`Pong! \`${ping}ms\``);
        });
    },
};