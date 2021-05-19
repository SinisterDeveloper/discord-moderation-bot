
const Discord = require(`discord.js`);

const { prefix } = require('../../config.json');

module.exports = {
    name: 'mute',
    description: 'Mutes the given member',
    guildOnly: true,
    cooldown: 2,
    argument: `<user> {reason}`,
    permission: `ADMINISTRATOR`,
    async execute(message, args, client) {
        let toMute = message.mentions.members.first() || message.guild.members.cache.get(args[0]) || message.guild.members.cache.find(x => x.user.username.toLowerCase() === args.slice(0).join(" ") || x.user.username === args[0]);
        //Embed
        let Mutehelp = new Discord.MessageEmbed()
            .setTitle(`${this.name} - Moderation`)
            .addField(`Description`, this.description)
            .addField(`Usage`, this.usage)
            .addField(`Cooldown`, `${this.cooldown} second(s)`);
        let mutedRole = message.guild.roles.cache.find(r => r.name === `Muted`);
        let reason = args.slice(1).join(" ") || "No reason specified"

        if (!mutedRole) {
            console.log(`Muted role not found`)
            try {
                mutedRole = await message.guild.roles.create({
                    data: {
                        name: 'Muted',
                        color: '#000000',
                    },
                    reason: 'Setting up Muted Role',
                });
                message.guild.channels.cache.forEach(async (channel) => {
                    await channel.updateOverwrite(mutedRole, {
                        'SEND_MESSAGES': false,
                        'EMBED_LINKS': false,
                        'ATTACH_FILES': false,
                        'ADD_REACTIONS': false,
                        'CONNECT': false,
                        'SPEAK': false,
                    })
                });

            } catch {
                console.log(`Something went wrong(Mute Command)`)
            };
        }

        if (!toMute) {
            return message.channel.send(Mutehelp);
        }
        //Muted Embeds
        let MuteNotificationDM = new Discord.MessageEmbed()
            .setColor("#000000")
            .setTitle("Notification")
            .setDescription(`You were muted in **${message.guild}** for: ${reason}`)
            .setTimestamp();
        let MuteNotificationChannel = new Discord.MessageEmbed()
            .setColor("#000000")
            .setDescription(`**${toMute} has been muted ||** ${reason}`);
        let adminMute = new Discord.MessageEmbed()
            .setColor(`#000000`)
            .setDescription(`I may not mute administrators!`);
        let selfMute = new Discord.MessageEmbed()
            .setColor(`#000000`)
            .setDescription(`You may not mute yourself!`);

        if (toMute.id === message.author.id) return message.channel.send(selfMute);
        if (toMute.hasPermission(`ADMINISTRATOR`)) return message.channel.send(adminMute);

        try {
            await toMute.roles.add(mutedRole, reason);
            await toMute.send(MuteNotificationDM)
            console.log(`DMed hottie`);
            message.channel.send(MuteNotificationChannel)
        } catch {
            toMute.roles.add(mutedRole, reason);
            message.channel.send(MuteNotificationChannel)
        }
    }
}