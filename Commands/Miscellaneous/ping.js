const { prefix } = require('../../config.json');

module.exports = {
    name: 'ping',
    description: 'Check the bot latency',
    cooldown: 3,
    permission: `SEND_MESSAGES`,
    usage: prefix + this.name,
    async execute(message) {
        await message.channel.send({ content: 'Pong!' }).then(resultMessage => {
            const ping = resultMessage.createdTimestamp - message.createdTimestamp
            resultMessage.edit({ content: `Pong! \`${ping}ms\`` });
        });
    },
};
