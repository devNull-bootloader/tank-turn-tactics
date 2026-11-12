const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const User = require("../models/UserModel.js");
const { validPassword } = require("../libs/password_utils.js");
const { normalizeUsername } = require("../controllers/AuthController.js");

const fieldNames = {
    usernameField: 'username',
    passwordField: 'password'
}

/**
 * @param username
 * @param password
 * @param done Finished callback
 */
function verifyCallback(username, password, done) {
    const normalized = normalizeUsername(username);

    User.findOne({ username: normalized }, async function (err, user) {
        if (err) { console.log("DB Error"); return done(err); }

        // Backward-compatible: older accounts may still only have email
        if (!user && username && String(username).includes('@')) {
            try {
                user = await User.findOne({ email: String(username).trim().toLowerCase() });
            } catch (_) {
                user = null;
            }
        }

        if (!user) {
            console.log("Incorrect username")
            return done(null, false, { message: 'Incorrect username.' });
        }

        if (user.guest) {
            console.log("Guest accounts cannot password-login")
            return done(null, false, { message: 'Guest account.' });
        }

        if (user.debug) {
            console.log("Debug accounts cannot password-login")
            return done(null, false, { message: 'Debug account.' });
        }

        if (user.bot) {
            console.log("Bot accounts cannot password-login")
            return done(null, false, { message: 'Bot account.' });
        }

        validPassword(password, user.hash, user.salt)
            .then(isValid => {
                if (!isValid) {
                    console.log("Incorrect password")
                    return done(null, false, { message: 'Incorrect password.' });
                }

                console.log("Logged in successfully")
                return done(null, user);
            })
            .catch(err => {
                console.log("Password check Error");
                done(err)
            })
    });
}

const strategy = new LocalStrategy(fieldNames, verifyCallback)

passport.use(strategy)

passport.serializeUser((user, done) => {
    const id = user && (user.id || (user._id && user._id.toString ? user._id.toString() : user._id));
    done(null, id)
})

passport.deserializeUser((uid, done) => {
    User.findById(uid)
        .then(user => done(null, user))
        .catch(err => done(err))
})
