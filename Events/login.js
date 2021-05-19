const Discord = require(`discord.js`);
const { prefix } = require(`../config.json`)

module.exports = {
    name: `ready`,
    once: true,
    async execute(client) {
        console.log(`${client.user.username} has logged in.`);
        await client.user.setActivity(`${prefix}help`, {
            type: 'PLAYING'
        });
    }
};