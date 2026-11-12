const Game = require('../models/GameModel.js');
const Player = require('../models/PlayerModel.js');
const { performActions, doActionQueue } = require('../config/game_runner.js');
const { editGameRequest } = require('./GameController.js');
const { displayName } = require('./AuthController.js');

function gameIdParam(req) {
    return req.params.gameId || req.body.gameId;
}

async function loadGame(gameId) {
    const game = await Game.findById(gameId);
    if (!game) {
        const err = new Error('Game not found');
        err.status = 404;
        throw err;
    }
    return game;
}

module.exports.renderDebugPanel = async function renderDebugPanel(req, res) {
    const games = await Game.find({});
    const gameList = Array.isArray(games) ? games : [];

    const enriched = await Promise.all(gameList.map(async (game) => {
        const players = await Player.find({ game_id: game._id });
        const playerArr = Array.isArray(players) ? players : [];
        return {
            id: game._id && game._id.toString ? game._id.toString() : String(game._id || game.id),
            name: game.name,
            hasStarted: !!game.hasStarted,
            turnTime: game.turnTime,
            turnTimePassed: game.turnTimePassed,
            actionsPerInterval: game.actionsPerInterval,
            doActionQueue: !!game.doActionQueue,
            doBroadcastAction: !!game.doBroadcastAction,
            doFogOfWar: !!game.doFogOfWar,
            doBounty: !!game.doBounty,
            allowAlwaysJoin: !!game.allowAlwaysJoin,
            queuedActions: Array.isArray(game.actions) ? game.actions.length : 0,
            players: playerArr.map((p) => ({
                id: p._id && p._id.toString ? p._id.toString() : String(p._id || p.id),
                name: p.name,
                health: p.health,
                actions: p.actions,
                range: p.range,
                sight: p.sight
            }))
        };
    }));

    res.render('pages/debug', {
        user: displayName(req.user),
        isDebug: !!(req.user && req.user.debug),
        isAdmin: !!(req.user && req.user.admin),
        intervalMode: process.env.INTERVAL_MODE || 'hour',
        games: enriched
    });
};

/** Advance one scheduler tick (hour/minute) for a single game. */
module.exports.tickGame = async function tickGame(req, res) {
    try {
        const game = await loadGame(gameIdParam(req));
        if (!game.hasStarted) {
            return res.status(400).json({ ok: false, message: 'Game has not started' });
        }
        await performActions(game);
        const refreshed = await Game.findById(game._id);
        return res.json({
            ok: true,
            turnTimePassed: refreshed.turnTimePassed,
            turnTime: refreshed.turnTime,
            queuedActions: Array.isArray(refreshed.actions) ? refreshed.actions.length : 0
        });
    } catch (err) {
        console.error('[debug] tickGame', err);
        return res.status(err.status || 500).json({ ok: false, message: err.message || String(err) });
    }
};

/** Force end of current round (set turn clock to end, then resolve). */
module.exports.forceRound = async function forceRound(req, res) {
    try {
        const game = await loadGame(gameIdParam(req));
        if (!game.hasStarted) {
            return res.status(400).json({ ok: false, message: 'Game has not started' });
        }
        game.turnTimePassed = game.turnTime;
        await game.save();
        await performActions(game);
        const refreshed = await Game.findById(game._id);
        return res.json({
            ok: true,
            turnTimePassed: refreshed.turnTimePassed,
            turnTime: refreshed.turnTime,
            queuedActions: Array.isArray(refreshed.actions) ? refreshed.actions.length : 0
        });
    } catch (err) {
        console.error('[debug] forceRound', err);
        return res.status(err.status || 500).json({ ok: false, message: err.message || String(err) });
    }
};

/** Resolve the action queue without advancing the day clock. */
module.exports.resolveQueue = async function resolveQueue(req, res) {
    try {
        const game = await loadGame(gameIdParam(req));
        const players = await Player.find({ game_id: game._id });
        await doActionQueue(game, players);
        const refreshed = await Game.findById(game._id);
        return res.json({
            ok: true,
            queuedActions: Array.isArray(refreshed.actions) ? refreshed.actions.length : 0
        });
    } catch (err) {
        console.error('[debug] resolveQueue', err);
        return res.status(err.status || 500).json({ ok: false, message: err.message || String(err) });
    }
};

module.exports.clearQueue = async function clearQueue(req, res) {
    try {
        const game = await loadGame(gameIdParam(req));
        game.actions = [];
        await game.save();
        return res.json({ ok: true, queuedActions: 0 });
    } catch (err) {
        console.error('[debug] clearQueue', err);
        return res.status(err.status || 500).json({ ok: false, message: err.message || String(err) });
    }
};

module.exports.grantAp = async function grantAp(req, res) {
    try {
        const game = await loadGame(gameIdParam(req));
        const amount = Math.max(0, parseInt(req.body.amount, 10) || 1);
        const players = await Player.find({ game_id: game._id });
        const list = Array.isArray(players) ? players : [];
        await Promise.all(list.map(async (p) => {
            if (p.health > 0) {
                p.actions = (p.actions || 0) + amount;
                await p.save();
            }
        }));
        return res.json({ ok: true, amount, playersUpdated: list.filter((p) => p.health > 0).length });
    } catch (err) {
        console.error('[debug] grantAp', err);
        return res.status(err.status || 500).json({ ok: false, message: err.message || String(err) });
    }
};

module.exports.setTurnProgress = async function setTurnProgress(req, res) {
    try {
        const game = await loadGame(gameIdParam(req));
        if (req.body.turnTime != null) {
            const n = parseInt(req.body.turnTime, 10);
            if (Number.isFinite(n) && n > 0) game.turnTime = n;
        }
        if (req.body.turnTimePassed != null) {
            const n = parseInt(req.body.turnTimePassed, 10);
            if (Number.isFinite(n) && n >= 0) game.turnTimePassed = n;
        }
        if (req.body.actionsPerInterval != null) {
            const n = parseInt(req.body.actionsPerInterval, 10);
            if (Number.isFinite(n) && n >= 0) game.actionsPerInterval = n;
        }
        await game.save();
        return res.json({
            ok: true,
            turnTime: game.turnTime,
            turnTimePassed: game.turnTimePassed,
            actionsPerInterval: game.actionsPerInterval
        });
    } catch (err) {
        console.error('[debug] setTurnProgress', err);
        return res.status(err.status || 500).json({ ok: false, message: err.message || String(err) });
    }
};

/** Reuse admin editGame for toggleable flags / settings. */
module.exports.updateSettings = editGameRequest;

module.exports.updatePlayer = async function updatePlayer(req, res) {
    try {
        const player = await Player.findById(req.params.playerId);
        if (!player) {
            return res.status(404).json({ ok: false, message: 'Player not found' });
        }
        const body = req.body || {};
        for (const key of ['health', 'actions', 'range', 'sight']) {
            if (body[key] === undefined) continue;
            const n = parseInt(body[key], 10);
            if (Number.isFinite(n)) player[key] = n;
        }
        if (body.name != null && String(body.name).trim()) {
            player.name = String(body.name).trim().slice(0, 32);
        }
        await player.save();
        return res.json({
            ok: true,
            player: {
                id: player._id.toString(),
                name: player.name,
                health: player.health,
                actions: player.actions,
                range: player.range,
                sight: player.sight
            }
        });
    } catch (err) {
        console.error('[debug] updatePlayer', err);
        return res.status(err.status || 500).json({ ok: false, message: err.message || String(err) });
    }
};
