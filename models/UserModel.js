const useSupabase = require('../libs/db_mode').useSupabase();

if (useSupabase) {
    module.exports = require('../libs/supabase_models').User;
} else {
    const mongoose = require("mongoose");

    const userSchema = new mongoose.Schema({
        username: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true
        },
        // Kept optional for older records / display fallbacks
        email: {
            type: String,
            required: false,
            sparse: true
        },
        hash: {
            type: String,
            required: true
        },
        salt: {
            type: String,
            required: true
        },
        guest: {
            type: Boolean,
            default: false
        },
        debug: {
            type: Boolean,
            default: false
        },
        bot: {
            type: Boolean,
            default: false
        },
        admin: {
            type: Boolean,
            default: false
        }
    }, { timestamps: true })

    const User = mongoose.model("users", userSchema);
    module.exports = User;
}
