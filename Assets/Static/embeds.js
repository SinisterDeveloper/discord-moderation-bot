const { MessageEmbed } = require('discord.js');
const colors = require('./colors');
const { defaultCooldown } = require('../../config.json');

/* Moderation commands */
const PunishUserHigher = new MessageEmbed()
	.setColor(colors.accentColor)
	.setTitle("Permissions missing!")
	.setDescription("You may not target this member as they have a higher role/same role as you.")
	.setTimestamp();

const punishUserHigherBot = new MessageEmbed()
	.setColor(colors.accentColor)
	.setTitle("Permissions missing!")
	.setDescription("I may not target this member as they have a higher role/same role as me.")
	.setTimestamp();

const punishNotificationDM = new MessageEmbed()
	.setColor(colors.accentColor)
	.setTitle("Notification")
	.setTimestamp();

const punishNotificationChannel = new MessageEmbed()
	.setColor(colors.accentColor);

const isAdmin = new MessageEmbed()
	.setColor(colors.accentColor)
	.setDescription(`I may not target this user as he is an admin`);

exports.moderationCommands = {
	PunishUserHigher,
	punishUserHigherBot,
	punishNotificationDM,
	punishNotificationChannel,
	isAdmin
};


// Misc Embeds

function sendUsage(command) {
	const usageEmbed = new MessageEmbed();
	let aliases = [];

	command.aliases.forEach(a => {
		aliases.push(`\`${a}\``);
	});
	usageEmbed.setColor(colors.accentColor);
	usageEmbed.setTitle(`Command - ${command.name.toUpperCase()}`);
	usageEmbed.setDescription(command.description ? command.description : "No description specified");
	usageEmbed.addField('Usage', command.usage ? `\`${command.usage}\`` : "No usage specified");
	usageEmbed.addField('Aliases', aliases.length ? aliases.join(', ') : "There are no aliases for this command");
	usageEmbed.addField('Cooldown', `${command.cooldown || defaultCooldown} seconds`);

	return usageEmbed;
}

function sendHelp(misc, mod, admin) {
	return new MessageEmbed()
		.setColor(colors.accentColor)
		.setTimestamp()
		.setTitle(`Commands`)
		.addField(`Administration`, admin.length ? admin.join(', ') : "There are no Administration commands, very strange...")
		.addField(`Miscellaneous`, misc.length ? misc.join(', ') : "There are no Miscellaneous commands, very strange...")
		.addField(`Moderation`, mod.length ? mod.join(', ') : "There are no Moderation commands, very strange...");

}

exports.miscellaneous = {
	sendUsage: sendUsage,
	help: sendHelp
};