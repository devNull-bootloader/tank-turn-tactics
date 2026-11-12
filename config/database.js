const { useSupabase } = require('../libs/db_mode');
const User = require('../models/UserModel.js')
const { createUser } = require("../controllers/AuthController.js");

let memoryServer = null;
let connectPromise = null;

const dbOptions = {
    useNewUrlParser: true,
    useFindAndModify: false,
    useUnifiedTopology: true,
    useCreateIndex: true,
    writeConcern: {
        j: true
    }
}

function allowMemoryFallback() {
    return process.env.NODE_ENV === 'development'
        || process.env.USE_MEMORY_DB === 'true'
        || process.env.VERCEL === '1';
}

async function ensureAdmin() {
    const adminUsername = process.env.ADMIN_USERNAME
        || (process.env.ADMIN_EMAIL ? String(process.env.ADMIN_EMAIL).split('@')[0] : null);
    if (!adminUsername || !process.env.ADMIN_PASSWORD) return;
    try {
        const existing = await User.findOne({ username: String(adminUsername).toLowerCase() });
        if (!existing) {
            await createUser(adminUsername, process.env.ADMIN_PASSWORD, true);
            console.log('Admin created!');
        }
    } catch (err) {
        console.error('[db] Admin setup failed:', err.message);
    }
}

async function ensureConnected(app) {
    if (useSupabase()) {
        if (!connectPromise) {
            connectPromise = (async () => {
                const { pingSupabase } = require('./supabase.js');
                const status = await pingSupabase();
                if (!status.ok) {
                    throw new Error('Supabase unavailable: ' + status.message);
                }
                console.log('[supabase] Connected');
                await ensureAdmin();
                if (app && typeof app.emit === 'function') app.emit('ready');
            })().catch(err => {
                connectPromise = null;
                throw err;
            });
        }
        await connectPromise;
        return { dbUri: process.env.SUPABASE_URL, dbOptions: {}, mode: 'supabase' };
    }

    const mongoose = require('mongoose');
    mongoose.Promise = global.Promise;

    if (mongoose.connection.readyState === 1) {
        return { dbUri: process.env.DB_URI || memoryServer?.getUri?.(), dbOptions, mode: 'mongo' };
    }

    if (!connectPromise) {
        connectPromise = (async () => {
            let dbUri = process.env.DB_URI;
            if (!dbUri) {
                if (!allowMemoryFallback()) {
                    throw new Error('DB_URI environment variable is required outside development');
                }
                if (!process.env.HOME || process.env.VERCEL === '1') {
                    process.env.HOME = '/tmp';
                }
                process.env.MONGOMS_DOWNLOAD_DIR = process.env.MONGOMS_DOWNLOAD_DIR || '/tmp/mongodb-binaries';
                const { MongoMemoryServer } = require('mongodb-memory-server');
                memoryServer = await MongoMemoryServer.create({
                    binary: { version: '7.0.14' }
                });
                dbUri = memoryServer.getUri();
                console.log('[mongodb] No DB_URI set; using in-memory MongoDB');
            }

            await mongoose.connect(dbUri, dbOptions);
            console.log(`[mongodb] Connected to database ${mongoose.connection.name}`);
            await ensureAdmin();
            if (app && typeof app.emit === 'function') app.emit('ready');
            return dbUri;
        })().catch(err => {
            connectPromise = null;
            throw err;
        });
    }

    const dbUri = await connectPromise;
    return { dbUri: process.env.DB_URI || dbUri || memoryServer?.getUri?.(), dbOptions, mode: 'mongo' };
}

module.exports = async function (app) {
    return ensureConnected(app);
};

module.exports.ensureConnected = ensureConnected;
module.exports.getMemoryServer = () => memoryServer;
module.exports.useSupabase = useSupabase;
