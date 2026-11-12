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

/**
 * Resolve the MongoDB URI, starting an in-memory server in development when DB_URI is unset.
 * @return {Promise<string>}
 */
async function resolveDbUri() {
    if (process.env.DB_URI) {
        return process.env.DB_URI;
    }

    if (process.env.NODE_ENV !== 'development') {
        throw new Error('DB_URI environment variable is required outside development');
    }

    const { MongoMemoryServer } = require('mongodb-memory-server');
    // MongoDB >= 6.0.4 is required on Ubuntu 22.04+/24.04 (OpenSSL 3).
    memoryServer = await MongoMemoryServer.create({
        binary: { version: '7.0.14' }
    });
    const uri = memoryServer.getUri();
    console.log('[mongodb] No DB_URI set; using in-memory MongoDB for development');
    return uri;
}

/**
 * Connects to the mongoose database, and emits ready when connected. Retries if failed.
 * @param app
 * @param {string} dbUri
 * @param {number} timeout Timeout in ms
 */
function connectToDB(app, dbUri, timeout) {
    mongoose.connect(dbUri, dbOptions)
        .then(m => {
            console.log(`[mongodb] Connected to database ${m.connection.name}`);

            // Set admin user when credentials are configured
            if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
                User.findOne({ email: process.env.ADMIN_EMAIL })
                    .then(player => {
                        if (!player) {
                            createUser(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, true)
                                .then(() => console.log("Admin created!"))
                                .catch(err => console.error('[mongodb] Failed to create admin:', err.message))
                        }
                    })
                    .catch(err => console.error('[mongodb] Admin lookup failed:', err.message))
            }

            app.emit('ready')
        })
        .catch(err => {
            console.error('[mongodb] ' + err + ', retrying in ' + timeout / 1000 + ' seconds')
            setTimeout(() => connectToDB(app, dbUri, timeout), timeout)
        });
}

/**
 * @param app
 * @return {Promise<{dbUri: string, dbOptions: object}>}
 */
module.exports = async function (app) {
    const dbUri = await resolveDbUri();
    connectToDB(app, dbUri, 5000)

    return { dbUri, dbOptions }
};

module.exports.getMemoryServer = () => memoryServer;
