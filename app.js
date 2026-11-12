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
        if (!process.env.ADMIN_USERNAME && !process.env.ADMIN_EMAIL) {
            process.env.ADMIN_USERNAME = 'admin';
        }
        if (!process.env.ADMIN_USERNAME && process.env.ADMIN_EMAIL) {
            process.env.ADMIN_USERNAME = String(process.env.ADMIN_EMAIL).split('@')[0] || 'admin';
        }
        if (!process.env.ADMIN_PASSWORD) process.env.ADMIN_PASSWORD = 'admin';
        if (!process.env.INTERVAL_MODE) process.env.INTERVAL_MODE = 'hour';
    }
}

loadEnvDefaults();

const app = express();
let bootPromise = null;
let readyApp = false;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// If an older rewrite sent traffic to /api/*, strip the prefix so routes match.
app.use((req, res, next) => {
    if (req.url === '/api') {
        req.url = '/';
    } else if (req.url.startsWith('/api/')) {
        req.url = req.url.slice(4) || '/';
    }
    next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(require('./middlewares/i18n_middleware.js'));
app.use((req, res, next) => {
    res.locals.currentPath = req.originalUrl || req.url || '/';
    next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

async function boot() {
    if (!process.env.SESSION_SECRET) {
        throw new Error('SESSION_SECRET environment variable is required');
    }

    const { dbUri, dbOptions, mode } = await require('./config/database.js')(app);
    const { useSupabase } = require('./libs/db_mode');

    let sessionStore;
    if (useSupabase()) {
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
        saveUninitialized: false,
        store: sessionStore,
        cookie: {
            maxAge: 1000 * 60 * 60 * 24 * 14,
            httpOnly: true,
            secure: process.env.COOKIE_SECURE === 'true',
            sameSite: 'lax'
        }
    }));

    require('./config/passport.js');
    app.use(passport.initialize());
    app.use(passport.session());
    app.use((req, res, next) => {
        res.locals.currentUser = req.user || null;
        next();
    });

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
    // Alias so /health also works if /api was stripped
    app.get('/health', async (req, res) => {
        res.redirect(307, '/api/health');
    });

    require('./routes')(app);

    app.use((err, req, res, next) => {
        console.error('[app] request error:', err);
        if (res.headersSent) {
            return next(err);
        }
        const wantsHtml = req.accepts('html');
        if (wantsHtml) {
            return res.status(500).send('Something went wrong. Please try again.');
        }
        return res.status(500).json({ error: String(err && err.message ? err.message : err) });
    });

    app.use(function (req, res) {
        res.status(404).send('Whoops, not found!');
    });

    if (process.env.VERCEL !== '1' && process.env.DISABLE_GAME_RUNNER !== 'true') {
        require('./config/game_runner.js');
    }

    readyApp = true;
    return app;
}

function ensureBooted() {
    if (!bootPromise) {
        bootPromise = boot().catch(err => {
            bootPromise = null;
            readyApp = false;
            throw err;
        });
    }
    return bootPromise;
}

// Gate every request until async DB/session wiring is ready
app.use(async (req, res, next) => {
    try {
        if (!readyApp) {
            await ensureBooted();
        }
        next();
    } catch (err) {
        console.error('[app] Boot failed:', err);
        res.status(503).send('Service unavailable');
    }
});

module.exports = app;
module.exports.getApp = async () => {
    await ensureBooted();
    return app;
};

if (require.main === module) {
    ensureBooted()
        .then(() => {
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
