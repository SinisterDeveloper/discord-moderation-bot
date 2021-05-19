const Discord = require('discord.js');

const { prefix } = require('../../config.json');

module.exports = {
    name: `softban`,
    description: `Bans a member from the Guild and immediately unbans them, clearing out their messages`,
    cooldown: 5,
    usage: prefix + this.name + ` <user> {reason}`,
    argument: `<user> {reason}`,
    permission: `BAN_MEMBERS`,
    async execute(message, args, client) {
        let toBan = message.mentions.members.first() || message.guild.members.cache.get(args[0]) || message.guild.members.cache.find(x => x.user.username.toLowerCase() === args.slice(0).join(" ") || x.user.username === args[0]);
        let banHelp = new Discord.MessageEmbed()
            .setTitle(`Ban - Moderation`)
            .addField(`Description`, this.description)
            .addField(`Usage`, this.usage)
            .addField(`Sub Commands:`, `\`${prefix}ban save <user> {reason}\` -- Bans user without deleting his/her messages \n\`,ban force <userID> {reason}\` -- Bans a user even if they aren't in the server`)
            .addField(`Cooldown`, `${this.cooldown} second(s)`)
            .addField(`Warning:`, `This command will not work if the specified user is not in the guild, use the "Ban Force" command instead(\`,help ban-force\`) to ban users outside the guild.`)
            .setTimestamp();
        if (!toBan) return message.channel.send(banHelp)
        let PunishUserHigher = new Discord.MessageEmbed()
            .setColor("#000000")
            .setTitle("Permissions missing!")
            .setDescription("You may not target this member as they have a higher role/same role as you.")
            .setTimestamp();
        if (toBan.roles.highest.position > message.member.roles.highest.position)
            return message.channel.send(PunishUserHigher);
        if (toBan.roles.highest.position == message.member.roles.highest.position)
            return message.channel.send(PunishUserHigher);

        let reason = args.slice(1).join(" ") || "No reason specified"
        let BanNotificationDM = new Discord.MessageEmbed()
            .setColor("#000000")
            .setTitle("Notification")
            .setDescription(`You were softbanned in **${message.guild}** for: ${reason}`)
            .setTimestamp();
        let BanNotificationChannel = new Discord.MessageEmbed()
            .setColor("000000")
            .setDescription(`**${toBan} has been softbanned ||** ${reason}`);

        //End of definitions
        try {
            await toBan.send(BanNotificationDM)
            await toBan.ban({
                days: 7,
                reason: reason
            })
            await message.guild.members.unban(toBan, reason);
        } catch {
            toBan.ban({
                days: 7,
                reason: reason
            })
            await message.guild.members.unban(toBan, reason);
        };
        message.channel.send(BanNotificationChannel);
    }
}