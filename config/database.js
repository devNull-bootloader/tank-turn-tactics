const mongoose = require('mongoose');
const User = require('../models/UserModel.js')
const { createUser } = require("../controllers/AuthController.js");

mongoose.Promise = global.Promise;

const dbOptions = {
    useNewUrlParser: true,
    useFindAndModify: false,
    useUnifiedTopology: true,
    useCreateIndex: true,
    writeConcern: {
        j: true
    }
}

let memoryServer = null;
let connectPromise = null;

function allowMemoryFallback() {
    return process.env.NODE_ENV === 'development'
        || process.env.USE_MEMORY_DB === 'true'
        || process.env.VERCEL === '1';
}

/**
 * Resolve the MongoDB URI, starting an in-memory server when DB_URI is unset
 * in development / Vercel demo mode.
 * @return {Promise<string>}
 */
async function resolveDbUri() {
    if (process.env.DB_URI) {
        return process.env.DB_URI;
    }

    if (!allowMemoryFallback()) {
        throw new Error('DB_URI environment variable is required outside development');
    }

    // Vercel sandboxes have no writable $HOME — keep MMS artifacts under /tmp.
    if (!process.env.HOME || process.env.VERCEL === '1') {
        process.env.HOME = '/tmp';
    }
    process.env.MONGOMS_DOWNLOAD_DIR = process.env.MONGOMS_DOWNLOAD_DIR || '/tmp/mongodb-binaries';

    const { MongoMemoryServer } = require('mongodb-memory-server');
    // MongoDB >= 6.0.4 is required on Ubuntu 22.04+/24.04 (OpenSSL 3).
    memoryServer = await MongoMemoryServer.create({
        binary: { version: '7.0.14' }
    });
    const uri = memoryServer.getUri();
    console.log('[mongodb] No DB_URI set; using in-memory MongoDB');
    return uri;
}

/**
 * Ensure a single shared mongoose connection (important on Vercel cold starts).
 * @param app
 * @return {Promise<void>}
 */
async function ensureConnected(app) {
    if (mongoose.connection.readyState === 1) {
        return;
    }

    if (!connectPromise) {
        connectPromise = (async () => {
            const dbUri = await resolveDbUri();
            await mongoose.connect(dbUri, dbOptions);
            console.log(`[mongodb] Connected to database ${mongoose.connection.name}`);

            if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
                try {
                    const existing = await User.findOne({ email: process.env.ADMIN_EMAIL });
                    if (!existing) {
                        await createUser(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, true);
                        console.log('Admin created!');
                    }
                } catch (err) {
                    console.error('[mongodb] Admin setup failed:', err.message);
                }
            }

            if (app && typeof app.emit === 'function') {
                app.emit('ready');
            }
        })().catch(err => {
            connectPromise = null;
            throw err;
        });
    }

    await connectPromise;
}

/**
 * @param app
 * @return {Promise<{dbUri: string, dbOptions: object}>}
 */
module.exports = async function (app) {
    const dbUri = process.env.DB_URI || 'memory';
    await ensureConnected(app);
    return { dbUri: process.env.DB_URI || memoryServer?.getUri?.() || dbUri, dbOptions }
};

module.exports.ensureConnected = ensureConnected;
module.exports.getMemoryServer = () => memoryServer;
