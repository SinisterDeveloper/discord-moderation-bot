const { MessageEmbed } = require('discord.js');
const colors = require('./colors');

/* Moderation commands */
const PunishUserHigher = new MessageEmbed()
	.setColor(colors.accentColor)
	.setTitle("Permissions missing!")
	.setDescription("You may not target this member as they have a higher role/same role as you.")
	.setTimestamp();

const punishUserHigherBot = new MessageEmbed()
	.setColor("#000000")
	.setTitle(colors.accentColor)
	.setDescription("I may not target this member as they have a higher role/same role as me.")
	.setTimestamp();

const punishNotificationDM = new MessageEmbed()
	.setColor(colors.accentColor)
	.setTitle("Notification")
	.setTimestamp();

const punishNotificationChannel = new MessageEmbed()
	.setColor(colors.accentColor);

exports.moderationCommands = {
	PunishUserHigher,
	punishUserHigherBot,
	punishNotificationDM,
	punishNotificationChannel
}
