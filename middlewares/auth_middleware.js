
module.exports.isLoggedIn = function (req, res, next) {
    if (req.isAuthenticated()) {
        next();
    } else if (req.accepts('html') && !req.path.startsWith('/game/') && req.method === 'GET') {
        res.redirect("/login");
    } else if (req.xhr || req.headers.accept === 'application/json' || req.path.startsWith('/game/')) {
        res.status(401).send('Unauthorized');
    } else {
        res.redirect("/login");
    }
}

module.exports.isAdmin = function (req, res, next) {
    if (req.isAuthenticated() && req.user.admin) {
        next()
    } else {
        res.status(401).send()
    }
}

/**
 * Require the requester to be the game creator or an admin.
 * Expects req.game to be set, or loads it from :gameId.
 */
module.exports.isGameCreatorOrAdmin = async function (req, res, next) {
    try {
        if (!req.isAuthenticated()) {
            return res.status(401).send('Unauthorized');
        }
        if (req.user.admin) {
            return next();
        }

        const Game = require('../models/GameModel.js');
        const game = req.game || await Game.findById(req.params.gameId);
        if (!game) {
            return res.status(404).send('Game not found');
        }

        const creatorId = game.creator_id && (game.creator_id.toString ? game.creator_id.toString() : String(game.creator_id));
        if (creatorId && creatorId === String(req.user.id)) {
            req.game = game;
            return next();
        }

        return res.status(403).send('Forbidden');
    } catch (e) {
        return res.status(500).send(e);
    }
}