const useSupabase = require('../libs/db_mode').useSupabase();

if (useSupabase) {
    module.exports = require('../libs/supabase_models').User;
} else {
    const mongoose = require("mongoose");

    const userSchema = new mongoose.Schema({
        email: {
            type: String,
            required: true,
            unique: true
        },
        hash: {
            type: String,
            required: true
        },
        salt: {
            type: String,
            required: true
        },
        admin: {
            type: Boolean,
            default: false
        }
    }, { timestamps: true })

    const User = mongoose.model("users", userSchema);
    module.exports = User;
}
