function updateModlog(client, user, item) {
	const modlogs = new Map(client.modlogs);

	const { server, modlog } = item;
	if (modlogs.has(user) && modlogs.get(user).hasOwnProperty(server)){
		const currentLogs = modlogs.get(user)[server] || [];
		currentLogs.push(modlog);
		modlogs.get(user)[server] = currentLogs;
	}
	else {
		modlogs.set(user, { [server]: [modlog] });
	}

	client.modlogs = modlogs;
}

module.exports = {
	updateModlog
}