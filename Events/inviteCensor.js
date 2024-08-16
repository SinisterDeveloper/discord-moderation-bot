module.exports = {
    name: `messageCreate`,
    async execute(message) {
        if (message.author.bot || !message.guild) return;
        if (message.channel.permissionsFor(message.member).has(`ADMINISTRATOR`)) return;

        const { guild, content } = message;

        async function isOwnInvite(guild, inviteCode) {
            const invites = await guild.invites.fetch();
            let isOwn = false;
            for (const invite of invites) {
                if (inviteCode === invite.code) {
                    isOwn = true;
                    break;
                }
            }
        }
        const code = content.split('discord.gg/')[1];
        if (content.includes('discord.gg/')) {
            const isOurInvite = await isOwnInvite(guild, code);

            if (!isOurInvite) {
                await message.delete();
                const alertMessage = await message.channel.send({ content: `Invite links are not allowed here, ${message.member}!` })
                setTimeout(() => alertMessage.delete(), 5000);
            }
        }
    }
};
