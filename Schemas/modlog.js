'use strict';

const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const ModlogSchema = new Schema({
    Type: {
        type: String,
        required: true
    },
    User: {
        type: String,
        required: true,
    },
    Moderator: {
        type: String,
    },
    Reason: {
        type: String,
        required: true
    },
    Date: {
        type: String,
    }

});

module.exports = mongoose.model('ModlogSchema', ModlogSchema);