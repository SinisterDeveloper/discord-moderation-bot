module.exports = {
    name: `message`,
    async execute(message) {
        if (message.channel.permissionsFor(message.member).has(`ADMINISTRATOR`)) return //Checks if the member is server admin

        const { guild, content } = message;

        //function
        const isInvite = async (guild, code) => {
            return await new Promise((resolve) => {
                guild.fetchInvites().then((invites) => {
                    for (const invite of invites) {
                        if (code === invite[0]) {
                            resolve(true)
                            return
                        }
                    }

                    resolve(false)
                })
            })
        }

        const code = content.split('discord.gg/')[1]

        if (content.includes('discord.gg/')) {

            const isOurInvite = await isInvite(guild, code)

            if (!isOurInvite) {
                await message.delete();
                await message.channel.send({ content: `Invite links are not allowed here ${message.member}.` })
                    .then(resultMessage => {
                    function sleep(ms) {
                        return new Promise(
                            resolve => setTimeout(resolve, ms));
                    }
                    sleep(5000)
                        .then(() => {
                            resultMessage.delete();
                        });
                });
            }
        }
    }
}
