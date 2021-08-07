'use strict';

const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const MuteRoleSchema = new Schema({
    GuildID: {
        type: String,
        required: true,
        unique: true,
    },
    RoleID: {
        type: String,
        required: true,
        unique: true,
    },
});

module.exports = mongoose.model('MuteRoleSchema', MuteRoleSchema);