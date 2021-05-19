const Discord = require('discord.js');

const { prefix } = require('../../config.json');

module.exports = {
    name: `nick`,
    description: `Changes a user's nickname`,
    guildOnly: true,
    cooldown: 5,
    argument: `<user> {New Nickname}`,
    aliases: [`nickname`, `setnick`],
    usage: prefix + this.name + ` <user> {New Nickname}`,
    permission: `MANAGE_NICKNAMES`,
    async execute(message, args, client) {

        let toNick = message.mentions.members.first() || message.guild.members.cache.get(args[0]) || message.guild.members.cache.find(x => x.user.username.toLowerCase() === args.slice(0).join(" ") || x.user.username === args[0]);
        
        let PunishUserHigher = new Discord.MessageEmbed()
            .setColor("#000000")
            .setTitle("Permissions missing!")
            .setDescription("You may not target this member as they have a higher role/same role as you.")
            .setTimestamp();
    
        let nickHelp = new Discord.MessageEmbed()
            .setTitle(`${this.name} - Moderation`)
            .addField(`Description`, this.description)
            .addField(`Usage`, this.usage)
            .addField(`Aliases`, `\`${this.aliases}\``)
            .addField(`Cooldown`, `${this.cooldown} second(s)`);

        if (!toNick) return message.channel.send(nickHelp);

        let nickname = args.slice(1).join(" ");

        if (!nickname) return message.channel.send(nickHelp);


        if (toNick.roles.highest.position > message.member.roles.highest.position)
            return message.channel.send(PunishUserHigher);

        if (toNick.roles.highest.position == message.member.roles.highest.position)
            return message.channel.send(PunishUserHigher);

        await toNick.setNickname(nickname);
        message.channel.send(`The user's nickname has been set to \`${nickname}\`.`);
    },
};