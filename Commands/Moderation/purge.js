const Discord = require("discord.js")

const { prefix } = require('../../config.json');

module.exports = {
    name: 'purge',
    description: 'Purges the given number of messages',
    guildOnly: true,
    cooldown: 10,
    usage: prefix + this.name + ` {limit}`,
    argument: `{limit}`,
    aliases: [`clear`],
    async execute(message, args) {
        let PurgeHelp = new Discord.MessageEmbed()
            .setTitle(`${this.name} - Moderation`)
            .addField(`Description`, this.description)
            .addField(`Usage`, this.usage)
            .addField(`Aliases`, `\`${this.aliases}\``)
            .addField(`Cooldown`, `${this.cooldown} second(s)`);

        if (isNaN(args[0]) || parseInt(args[0]) <= 0) {
            return message.channel.send(PurgeHelp);
        }

        let deleteAmount;
        if (parseInt(args[0]) > 100) {
            if (message.deletable) {
                await message.delete();
            }
            deleteAmount = 100;
        } else {
            if (message.deletable) {
                await message.delete();
            }
            deleteAmount = parseInt(args[0]);
        }

        await message.channel.bulkDelete(deleteAmount, true)
            .catch(err => message.reply(`Something went wrong... \`${err}\``));
    },
};