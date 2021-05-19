const Discord = require('discord.js');
const { prefix } = require('../../config.json');

module.exports = {
    name: `kick`,
    description: `Kicks a member from the guild`,
    guildOnly: true,
    cooldown: 5,
    argument: `<user> {reason}`,
    usage: prefix + this.name + ` <user> {reason}`,
    permission: `KICK_MEMBERS`,
    async execute(message, args) {
        let banHelp = new Discord.MessageEmbed()
            .setTitle(`${this.name} - Moderation`)
            .addField(`Description`, this.description)
            .addField(`Usage`, this.usage)
            .addField(`Cooldown`, `${this.cooldown} second(s)`);
        let PunishUserHigher = new Discord.MessageEmbed()
            .setColor("#000000")
            .setTitle("Permissions missing!")
            .setDescription("You may not target this member as they have a higher role/same role as you.")
            .setTimestamp();
        //End of Embed

        //Function

        let toBan = message.mentions.members.first() || message.guild.members.cache.get(args[0]) || message.guild.members.cache.find(x => x.user.username.toLowerCase() === args.slice(0).join(" ") || x.user.username === args[0]);
        
        let reason = args.slice(1).join(" ") || "No reason specified"

        if (!toBan) return message.channel.send(banHelp)

        if (toBan.roles.highest.position > message.member.roles.highest.position)
            return message.channel.send(PunishUserHigher);
        if (toBan.roles.highest.position == message.member.roles.highest.position)
            return message.channel.send(PunishUserHigher);

        let KickNotificationDM = new Discord.MessageEmbed()
            .setColor("#000000")
            .setTitle("Notification")
            .setDescription(`You were kicked in **${message.guild}** for: ${reason}`)
            .setTimestamp();
        let KickNotificationChannel = new Discord.MessageEmbed()
            .setColor("#11fc46")
            .setTitle("Member Kicked")
            .setDescription(`${toBan} has been kicked || ${reason}`)
            .setTimestamp();
        //End of definitions
        try {
            await toBan.send(KickNotificationDM)
            toBan.kick({
                reason: reason
            })
        } catch {
            toBan.kick({
                reason: reason
            });
        }
        message.channel.send(KickNotificationChannel);
    }
}