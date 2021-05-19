const Discord = require(`discord.js`);
const ms = require('ms');

const { prefix } = require('../../config.json');

module.exports = {
    name: 'tempmute',
    description: 'Temporarily mute the given member',
    guildOnly: true,
    cooldown: 2,
    argument: `<user> {reason}`,
    usage: prefix + this.name + ` <user> {reason}`,
    permission: `ADMINISTRATOR`,
    async execute(message, args, client) {
        const filter = m => m.author.id === message.author.id;
        
        let Mutehelp = new Discord.MessageEmbed()
            .setTitle(`${this.name} - Moderation`)
            .addField(`Description`, this.description)
            .addField(`Usage`, this.usage)
            .addField(`Cooldown`, `${this.cooldown} second(s)`);

        const toMute = message.mentions.members.first() || message.guild.members.cache.get(args[0]) || message.guild.members.cache.find(x => x.user.username.toLowerCase() === args.slice(0).join(" ") || x.user.username === args[0]);
        if (toMute) {
            let adminMute = new Discord.MessageEmbed()
                .setColor(`#000000`)
                .setDescription(`I may not mute administrators!`);
            let selfMute = new Discord.MessageEmbed()
                .setColor(`#000000`)
                .setDescription(`You may not mute yourself!`);
            if (toMute.id === message.author.id) return message.channel.send(selfMute);
            if (toMute.hasPermission(`ADMINISTRATOR`)) return message.channel.send(adminMute);
            let muteRole = message.guild.roles.cache.find(role => role.name === 'Muted');
            message.channel.send(`Please state the reason for the mute.`).then(async (message) => {
                let collectedReason = await message.channel.awaitMessages(filter, { max: 1 })
                let reason = collectedReason.first().content
                //Embeds
                let MuteNotificationDM = new Discord.MessageEmbed()
                    .setColor("#000000")
                    .setTitle("Notification")
                    .setDescription(`You were muted in **${message.guild}** for: ${reason}`)
                    .setTimestamp();
                let MuteNotificationChannel = new Discord.MessageEmbed()
                    .setColor("#000000")
                    .setDescription(`**${toMute} has been muted ||** ${reason}`);
                

                    
                if (!args[1]) {
                    try {
                        await toMute.roles.add(muteRole.id);
                        message.channel.send(MuteNotificationChannel);
                        toMute.send(MuteNotificationDM)
                        return
                    }
                    catch {
                        await toMute.roles.add(muteRole.id);
                        message.channel.send(MuteNotificationChannel);
                    }
                } else {
                    try {
                        await toMute.roles.add(muteRole.id);
                        message.channel.send(MuteNotificationChannel);
                        toMute.send(MuteNotificationDM)
                        setTimeout(function () {
                            toMute.roles.remove(muteRole.id);
                        }, ms(args[1]));
                    }
                    catch {
                        await toMute.roles.add(muteRole.id);
                        message.channel.send(MuteNotificationChannel);
                        setTimeout(function () {
                            toMute.roles.remove(muteRole.id);
                        }, ms(args[1]));
                    }
                }
            });
        } else message.channel.send(Mutehelp);
    }
}