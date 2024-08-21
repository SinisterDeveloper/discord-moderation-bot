const EMBEDS = require(`../Assets/Static/embeds`);

function daysElapsed(timestamp) {
	const now = Date.now();
	const elapsedMilliseconds = now - new Date(timestamp).getTime();
	const millisecondsPerDay = 24 * 60 * 60 * 1000;
	return (elapsedMilliseconds / millisecondsPerDay);
}

module.exports = {
	name: `guildMemberAdd`,
	async execute(client, member) {
		if (!client.minage.has(member.guild.id)) return;
		const minAge = client.minage.get(member.guild.id);
		const accountAge = daysElapsed(member.user.createdTimestamp);
		if (accountAge >= minAge) return;

		let kickNotificationDM = EMBEDS.moderationCommands.punishNotificationDM;
		kickNotificationDM.setDescription(`You were kicked from **${member.guild.name}** for: Account created ${accountAge} days ago, below minimum account age requirement of ${minAge} days.`);
		try {
			await member.send({ embeds: [kickNotificationDM] });
		} catch (e) {
			console.log('Unable to send Minage Kick notification to ' + member.user.username);
		} finally {
			await member.kick({reason: `Account created ${accountAge} days ago, below minimum account age requirement of ${minAge} days.`});
		}
	}
};
