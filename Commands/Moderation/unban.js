const Discord = require('discord.js');

const { prefix } = require('../../config.json');

module.exports = {
    name: `unban`,
    description: `Unbans the user from the guild`,
    guildOnly: true,
    cooldown: 5,
    usage: prefix + this.name + ` <user> {reason}`,
    permission: `BAN_MEMBERS`,
    argument: `<user> {reason}`,
    async execute(message, args, client) {
        
        const unbanHelp = new Discord.MessageEmbed()
            .setTitle(`${this.name} - Moderation`)
            .addField(`Description`, this.description)
            .addField(`Usage`, this.usage)
            .addField(`Cooldown`, `${this.cooldown} second(s)`);
        if (!args) return message.channel.send(unbanHelp);


        let toUnban = await client.users.fetch(args[0])
        
        let reason = args.slice(1).join(" ") || "No reason specified"

        let UnbanNotificationChannel = new Discord.MessageEmbed()
            .setColor("#000000")
            .setDescription(`**${toUnban}(ID: ${toUnban.id}) has been unbanned ||** ${reason}`);

        try {
            await message.guild.members.unban(toUnban, reason)
            await message.channel.send(UnbanNotificationChannel)
        } catch {
            message.channel.send(`Something went wrong!`)
        };
    },
};