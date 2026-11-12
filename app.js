const express = require('express');
const passport = require("passport");
const path = require('path');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
require('ejs')

async function bootstrap() {
    // Only use .env in development mode
    if (process.env.NODE_ENV === "development") {
        require('dotenv').config();

        // Sensible local defaults so `npm run start:dev` works out of the box
        if (!process.env.PORT) process.env.PORT = '3000';
        if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'dev-session-secret';
        if (!process.env.ADMIN_EMAIL) process.env.ADMIN_EMAIL = 'admin@example.com';
        if (!process.env.ADMIN_PASSWORD) process.env.ADMIN_PASSWORD = 'admin';
        if (!process.env.INTERVAL_MODE) process.env.INTERVAL_MODE = 'hour';
    }

    if (!process.env.PORT) {
        throw new Error('PORT environment variable is required');
    }
    if (!process.env.SESSION_SECRET) {
        throw new Error('SESSION_SECRET environment variable is required');
    }

    // Init app
    const app = express();

    // App configs
    app.set('view engine', 'ejs')

    // Post encoding
    app.use(express.urlencoded({ extended: true }))
    app.use(express.json())

    // Serve static resources
    app.use(express.static(path.join(__dirname, 'public')))
    app.use('/css', express.static(path.join(__dirname, 'public/css')))
    app.use('/js', express.static(path.join(__dirname, 'public/js')))

    // Create session with connect mongo (resolves in-memory URI in development when needed)
    const { dbUri, dbOptions } = await require('./config/database.js')(app)

    app.use(session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: true,
        store: new MongoDBStore({
            uri: dbUri,
            collection: 'sessions',
            options: dbOptions
        }),
        cookie: {
            maxAge: 1000 * 60 * 60 * 24 * 14,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production'
        }
    }))

    // Passport setup
    require('./config/passport.js')

    app.use(passport.initialize())
    app.use(passport.session())

    // Routes setup
    require('./routes')(app)

    // Error handling
    app.use((err, req, res, next) => {
        console.log(err)
        next(err);
    });

    app.use(function (req, res, next) {
        res.status(404).send("Whoops, not found!");
    });

    // Start game scheduler
    require("./config/game_runner.js")

    app.on('ready', () => {
        /* App started here */
        const server = app.listen(process.env.PORT, () => {

            const address = process.env.NODE_ENV === 'development' ? `http://localhost:${process.env.PORT}` : `port ${process.env.PORT}`;

            const time = new Date().toLocaleTimeString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })

            console.log(`[app] (${time}) Server running on ${address} in ${process.env.NODE_ENV} mode`)
        });

        return server;
    })
}

bootstrap().catch(err => {
    console.error('[app] Failed to start:', err)
    process.exit(1)
})
