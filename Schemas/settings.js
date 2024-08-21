'use strict';

const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const SettingsSchema = new Schema({
	GuildID: {
		type: String,
		required: true,
		unique: true,
	},
	MuteRoleID: {
		type: String,
		unique: true,
	},
	MinimumAge: {
		type: Number,
		default: 0,
	},
});

module.exports = mongoose.model('Setting', SettingsSchema);
