const EMBEDS = require(`../Assets/Static/embeds`);

function daysElapsed(timestamp) {
	const now = Date.now();
	const elapsedMilliseconds = now - new Date(timestamp).getTime();
	const millisecondsPerDay = 24 * 60 * 60 * 1000;
	return Math.floor(elapsedMilliseconds / millisecondsPerDay);
}

module.exports = {
	name: `guildMemberAdd`,
	async execute(client, member) {
		console.log('cooked');
		if (!client.minage.has(member.guild.id)) return;
		const minAge = client.minage.get(member.guild.id);
		const accountAge = daysElapsed(member.user.createdTimestamp);
		console.log(accountAge);
		if (accountAge >= minAge) return;

		let banNotificationDM = EMBEDS.moderationCommands.punishNotificationDM;
		banNotificationDM.setDescription(`You were banned from **${member.guild.name}** for: Account created ${accountAge} days ago, below minimum account age requirement of ${minAge} days.`);
		member.send({ embeds: [banNotificationDM] }).catch();
		return member.ban({ days: minAge - accountAge, reason: `Account created ${accountAge} days ago, below minimum account age requirement of ${minAge} days.` });
	}
};
