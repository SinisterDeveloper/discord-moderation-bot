const Discord = require('discord.js');
const { prefix } = require('../../config.json');

module.exports = {
    name: `ban`,
    description: `Ban a member from the guild`,
    cooldown: 5,
    usage: prefix + this.name + ` <user> {reason}`,
    argument: `<user> {reason}`,
    permission: `BAN_MEMBERS`,
    async execute(message, args, client) {
        let banHelpMain = new Discord.MessageEmbed()
            .setTitle(`Ban - Moderation`)
            .addField(`Description`, this.description)
            .addField(`Usage`, this.usage)
            .addField(`Sub Commands:`, `\`${prefix}ban save <user> {reason}\` -- Bans user without deleting his/her messages \n\`,ban force <userID> {reason}\` -- Bans a user even if they aren't in the server`)
            .addField(`Cooldown`, `${this.cooldown} second(s)`)
            .addField(`Warning:`, `This command will not work if the specified user is not in the guild, use the "Ban Force" command instead(\`,help ban-force\`) to ban users outside the guild.`)
            .setTimestamp();
        if (!args.length) return message.channel.send(banHelpMain);
        let banType = args[0].toLowerCase();
        const commandChannel = message.channel;
        //Normal Type
        if (banType !== `save` && banType !== `force`) {
            let toBan = message.mentions.members.first() || message.guild.members.cache.get(args[0]) || message.guild.members.cache.find(x => x.user.username.toLowerCase() === args.slice(0).join(" ") || x.user.username === args[0]);
            let errorEmbed = new Discord.MessageEmbed()
                .setDescription(`Member "${args[0]}" not found!`)
                .setColor(`#000000`)
            if (!toBan) return message.channel.send(errorEmbed)
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
                .setDescription(`You were banned in **${message.guild}** for: ${reason}`)
                .setTimestamp();

            //End of normal ban definitions
            try {
                await toBan.send(BanNotificationDM)
                toBan.ban({
                    days: 7,
                    reason: reason
                })
            } catch {
                toBan.ban({
                    days: 7,
                    reason: reason
                });
                let BanNotificationChannelNormal = new Discord.MessageEmbed()
                    .setColor("000000")
                    .setDescription(`**${toBan} has been banned ||** ${reason}`);
                commandChannel.send(BanNotificationChannelNormal);
            }
        };
        if (banType === `save`) {
            let toBan = message.mentions.members.first() || message.guild.members.cache.get(args[1]) || message.guild.members.cache.find(x => x.user.username.toLowerCase() === args.slice(1).join(" ") || x.user.username === args[1]);
            let reason = args.slice(1).join(" ") || "No reason specified";
            const BanNotificationChannelSave = new Discord.MessageEmbed()
                .setColor("000000")
                .setDescription(`**${toBan} has been banned ||** ${reason}`);
            let banHelp = new Discord.MessageEmbed()
                .setColor("#000000")
                .setTitle("Ban Save - Moderation")
                .setDescription(`Bans a member from the Guild without deleting their messages`)
                .addFields({
                    name: `Usage`, value: `\`${prefix}ban save <user> {reason}\``
                })
                .addField(`Cooldown`, `${this.cooldown} second(s)`)
                .addField(`Warning:`, `This command will not work if the specified user is not in the guild, use the "Ban Force" command to ban users outside the guild.`)
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
            let BanNotificationDM = new Discord.MessageEmbed()
                .setColor("#000000")
                .setTitle("Notification")
                .setDescription(`You were banned in **${message.guild}** for: ${reason}`)
                .setTimestamp();

            //End of normal ban definitions
            try {
                await toBan.send(BanNotificationDM)
                toBan.ban({
                    reason: reason
                })
                commandChannel.send(BanNotificationChannelSave);
            } catch {
                toBan.ban({
                    reason: reason
                });
                commandChannel.send(BanNotificationChannelSave);
            };
        };
        
        //Force Type
        if (banType === `force`) {
            const banGuild = message.guild;
            const banCheck = await message.guild.members.cache.get(args[1]);
            if (banCheck) return message.channel.send(`User is in the guild, use the normal ban command instead!`)
            let toBan = await client.users.fetch(args[1]);
            let reason = args.slice(2).join(" ") || "No reason specified";
            const BanNotificationChannelForce = new Discord.MessageEmbed()
                .setColor("000000")
                .setDescription(`**${toBan}(ID: ${toBan.id}) has been banned ||** ${reason}`);
            let banHelp = new Discord.MessageEmbed()
                .setColor("#000000")
                .setTitle("Ban - Moderation")
                .setDescription(`Bans a user even if they aren't in the Guild.`)
                .addFields({
                    name: `Usage`, value: `\`${prefix}ban force <user> {reason}\``
                })
                .addField(`Warning:`, `This command will not work if the specified user is in the guild, use the normal Ban command instead.`) //You may safely remove this line if you want
                .setTimestamp();
            if (!toBan) return message.channel.send(banHelp);

            //End of normal ban definitions
            await banGuild.members.ban(toBan, {
                days: 7,
                reason: reason
            })
            commandChannel.send(BanNotificationChannelForce);
        };
    },
};