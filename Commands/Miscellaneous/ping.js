const { prefix } = require('../../config.json');

module.exports = {
    name: 'ping',
    description: 'Check the bot latency',
    cooldown: 3,
    category: "miscellaneous",
	aliases: ['latency'],
    permission: `SEND_MESSAGES`,
    usage: prefix + this.name,
    async execute(message) {
        message.reply({ content: 'Pong!', allowedMentions: { repliedUser: false } })
	        .then(resultMessage => {
                const ping = resultMessage.createdTimestamp - message.createdTimestamp
                resultMessage.edit({ content: `Pong! \`${ping}ms\`` });
            });
    },
};
