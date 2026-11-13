const crypto = require('crypto');
const { hashPassword } = require("../libs/password_utils.js");
const User = require("../models/UserModel.js");

function normalizeUsername(username) {
    return String(username || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
}

function isValidUsername(username) {
    return /^[a-z0-9_]{3,24}$/.test(username);
}

async function createUser(username, password, admin = false, extra = {}) {
    const normalized = normalizeUsername(username);
    if (!isValidUsername(normalized)) {
        const err = new Error('Invalid username');
        err.code = 'INVALID_USERNAME';
        throw err;
    }

    const saltHash = await hashPassword(password);

    return await new User({
        username: normalized,
        hash: saltHash.hash,
        salt: saltHash.salt,
        admin,
        guest: !!extra.guest,
        debug: !!extra.debug,
        bot: !!extra.bot,
        email: extra.email
    }).save();
}

async function createGuestUser() {
    for (let attempt = 0; attempt < 5; attempt++) {
        const username = `guest_${crypto.randomBytes(3).toString('hex')}`;
        const password = crypto.randomBytes(16).toString('hex');
        try {
            return await createUser(username, password, false, { guest: true });
        } catch (err) {
            // retry on rare username collision
            if (attempt === 4) throw err;
        }
    }
}

async function createDebugUser() {
    for (let attempt = 0; attempt < 5; attempt++) {
        const username = `debug_${crypto.randomBytes(3).toString('hex')}`;
        const password = crypto.randomBytes(16).toString('hex');
        try {
            // Debug-only: never grant admin — /auth/debug is passwordless and public
            return await createUser(username, password, false, { debug: true });
        } catch (err) {
            if (attempt === 4) throw err;
        }
    }
}

async function createBotUser() {
    for (let attempt = 0; attempt < 5; attempt++) {
        const username = `bot_${crypto.randomBytes(3).toString('hex')}`;
        const password = crypto.randomBytes(16).toString('hex');
        try {
            return await createUser(username, password, false, { bot: true });
        } catch (err) {
            if (attempt === 4) throw err;
        }
    }
}

module.exports.register = function (req, res) {
    const username = normalizeUsername(req.body.username || req.body.email);
    const { password } = req.body;

    if (!password || String(password).length < 1) {
        return res.redirect('/register?error=invalid');
    }

    createUser(username, password)
        .then((user) => {
            req.login(user, (err) => {
                if (err) {
                    console.log(err);
                    return res.redirect('/register?error=true');
                }
                return res.redirect('/');
            });
        })
        .catch(err => {
            console.log(err);
            if (err && err.code === 'INVALID_USERNAME') {
                return res.redirect('/register?error=invalid');
            }
            res.redirect('/register?error=true');
        });
}

module.exports.guestLogin = async function (req, res, next) {
    try {
        const user = await createGuestUser();
        req.login(user, (err) => {
            if (err) return next(err);
            return res.redirect('/');
        });
    } catch (err) {
        console.log(err);
        res.redirect('/login?error=guest');
    }
}

module.exports.debugLogin = async function (req, res, next) {
    try {
        const user = await createDebugUser();
        req.login(user, (err) => {
            if (err) return next(err);
            return res.redirect('/debug');
        });
    } catch (err) {
        console.log(err);
        res.redirect('/login?error=debug&tab=debug');
    }
}

module.exports.logout = function (req, res) {
    req.logout();
    res.redirect('/login');
}

module.exports.createUser = createUser;
module.exports.createGuestUser = createGuestUser;
module.exports.createDebugUser = createDebugUser;
module.exports.createBotUser = createBotUser;
module.exports.normalizeUsername = normalizeUsername;
module.exports.displayName = function displayName(user) {
    if (!user) return 'Player';
    return user.username || (user.email ? String(user.email).split('@')[0] : 'Player');
}
