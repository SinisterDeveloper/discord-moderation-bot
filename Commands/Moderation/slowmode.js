const Discord = require("discord.js")

const { prefix } = require('../../config.json');

module.exports = {
    name: 'slowmode',
    description: 'Adds slowmode to a channel',
    aliases: ['setratelimit', `cooldown`],
    permission: `MANAGE_CHANNELS`,
    argument: `{duration}`,
    usage: prefix + this.name + ` {duration}`,
    async execute(message, args) {

        const { channel } = message
        if (!args.length) {
            await channel.setRateLimitPerUser(0, `Slowmode command provoked`)
            channel.send(`Slowmode for <#${channel.id}> has been set to \`0 seconds\`.`)

        };
        if (args[0]) {
            let duration = args;
            if (duration === 'Nil') {
                duration = 0
            }

            if (isNaN(duration)) {
                message.channel.send('Please provide a valid number or enter `0` if you do not want slowmode')
                return
            }
            await channel.setRateLimitPerUser(Math.floor(duration))
            channel.send(`Slowmode for <#${channel.id}> has been set to \`${duration} seconds\`.`);
        }
    },
};