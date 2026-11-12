const express = require('express');
const passport = require("passport");
const path = require('path');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
require('ejs');

const { pingSupabase } = require('./config/supabase.js');

function loadEnvDefaults() {
    if (process.env.NODE_ENV === 'development' || process.env.VERCEL === '1') {
        try {
            require('dotenv').config();
        } catch (_) {
            // optional locally / on Vercel
        }

        if (!process.env.PORT) process.env.PORT = '3000';
        if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'dev-session-secret';
        if (!process.env.ADMIN_EMAIL) process.env.ADMIN_EMAIL = 'admin@example.com';
        if (!process.env.ADMIN_PASSWORD) process.env.ADMIN_PASSWORD = 'admin';
        if (!process.env.INTERVAL_MODE) process.env.INTERVAL_MODE = 'hour';
    }
}

loadEnvDefaults();

let bootPromise = null;

async function createApp() {
    if (!process.env.SESSION_SECRET) {
        throw new Error('SESSION_SECRET environment variable is required');
    }

    const app = express();

    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    // On Vercel, files in public/ are served from the CDN automatically.
    if (process.env.VERCEL !== '1') {
        app.use(express.static(path.join(__dirname, 'public')));
        app.use('/css', express.static(path.join(__dirname, 'public/css')));
        app.use('/js', express.static(path.join(__dirname, 'public/js')));
    }

    const { dbUri, dbOptions, mode } = await require('./config/database.js')(app);
    const { useSupabase } = require('./libs/db_mode');

    let sessionStore;
    if (useSupabase()) {
        // Use MemoryStore on Vercel: Supabase direct DB hosts are often IPv6-only and
        // unreachable from Vercel functions. App data goes through the Supabase REST API.
        sessionStore = new session.MemoryStore();
        console.warn('[session] Using MemoryStore with Supabase REST data layer');
    } else {
        sessionStore = new MongoDBStore({
            uri: dbUri,
            collection: 'sessions',
            options: dbOptions
        });
    }

    app.use(session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: true,
        store: sessionStore,
        cookie: {
            maxAge: 1000 * 60 * 60 * 24 * 14,
            httpOnly: true,
            // Secure cookies break plain HTTP local/dev and some Vercel preview setups
            secure: process.env.COOKIE_SECURE === 'true'
        }
    }));

    require('./config/passport.js');
    app.use(passport.initialize());
    app.use(passport.session());

    app.get('/api/health', async (req, res) => {
        const supabase = await pingSupabase();
        let mongo = false;
        try {
            mongo = require('mongoose').connection.readyState === 1;
        } catch (_) {
            mongo = false;
        }
        res.json({
            ok: true,
            mode,
            mongo,
            supabase,
            vercel: process.env.VERCEL === '1'
        });
    });

    require('./routes')(app);

    app.use((err, req, res, next) => {
        console.log(err);
        next(err);
    });

    app.use(function (req, res) {
        res.status(404).send('Whoops, not found!');
    });

    // node-schedule only works on long-lived processes
    if (process.env.VERCEL !== '1' && process.env.DISABLE_GAME_RUNNER !== 'true') {
        require('./config/game_runner.js');
    }

    return app;
}

function getApp() {
    if (!bootPromise) {
        bootPromise = createApp().catch(err => {
            bootPromise = null;
            throw err;
        });
    }
    return bootPromise;
}

// Vercel / serverless handler — boot once, then delegate to Express
async function handler(req, res) {
    const app = await getApp();
    return app(req, res);
}

module.exports = handler;
module.exports.getApp = getApp;

if (require.main === module) {
    getApp()
        .then(app => {
            if (!process.env.PORT) {
                throw new Error('PORT environment variable is required');
            }

            app.listen(process.env.PORT, () => {
                const address = process.env.NODE_ENV === 'development'
                    ? `http://localhost:${process.env.PORT}`
                    : `port ${process.env.PORT}`;
                const time = new Date().toLocaleTimeString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
                console.log(`[app] (${time}) Server running on ${address} in ${process.env.NODE_ENV || 'production'} mode`);
            });
        })
        .catch(err => {
            console.error('[app] Failed to start:', err);
            process.exit(1);
        });
}
