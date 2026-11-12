const Game = require('../models/GameModel.js');
const Player = require('../models/PlayerModel.js');
const { createBotUser, displayName } = require('./AuthController.js');
const { assignLocation, checkRange, checkGrid } = require('../libs/game_utils.js');
const { move, attack, upgrade, logAction } = require('./ActionController.js');

const BOT_NAMES = ['Viper', 'Nomad', 'Rook', 'Cipher', 'Halo', 'Orbit', 'Quill', 'Axon'];
const BOT_COLORS = ['#ff6b6b', '#feca57', '#54a0ff', '#5f27cd', '#10ac84', '#ff9ff3', '#48dbfb', '#c8d6e5'];

/** Session-length bots pacing. Human multiplayer still uses the hourly cron. */
const PACE = {
    quick: {
        quickMatch: true,
        turnTime: 1,
        actionsPerInterval: 3,
        startingActions: 3
    },
    classic: {
        quickMatch: false,
        turnTime: 1,
        actionsPerInterval: 1,
        startingActions: 1
    }
};

function resolvePace(pace) {
    const key = String(pace || 'quick').toLowerCase();
    return PACE[key] || PACE.quick;
}

function sameId(a, b) {
    if (a == null || b == null) return false;
    return String(a) === String(b);
}

function samePos(a, b) {
    return a && b && Number(a.x) === Number(b.x) && Number(a.y) === Number(b.y);
}

function occupiedSet(players) {
    const set = new Set();
    for (const p of players) {
        if (p.health > 0 && p.position) {
            set.add(`${p.position.x},${p.position.y}`);
        }
    }
    return set;
}

function stepToward(from, to, occupied, game) {
    const deltas = [
        { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
        { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 }
    ];

    let best = null;
    let bestDist = Infinity;
    const goalDist = Math.hypot(to.x - from.x, to.y - from.y);

    for (const d of deltas) {
        const next = { x: from.x + d.x, y: from.y + d.y };
        if (!checkGrid(next, game)) continue;
        if (occupied.has(`${next.x},${next.y}`)) continue;
        const dist = Math.hypot(to.x - next.x, to.y - next.y);
        if (dist < bestDist || (dist === bestDist && dist < goalDist)) {
            bestDist = dist;
            best = next;
        }
    }
    return best;
}

async function createBotPlayer(game, index) {
    const user = await createBotUser();
    const name = BOT_NAMES[index % BOT_NAMES.length];
    const color = BOT_COLORS[index % BOT_COLORS.length];
    return await new Player({
        user_id: user.id || user._id,
        game_id: game._id,
        name,
        color,
        actions: game.actionsPerInterval || 1,
        isBot: true
    }).save();
}

/**
 * Create and immediately start a vs-bots match for the given human user.
 * Default pace is Quick (seconds tick + more AP) so matches feel session-length.
 */
async function createVsBotsGame(humanUser, opts = {}) {
    const isTutorial = !!opts.isTutorial;
    const botCount = Math.min(6, Math.max(1, parseInt(opts.botCount, 10) || (isTutorial ? 2 : 3)));
    const size = Math.min(16, Math.max(6, parseInt(opts.size, 10) || (isTutorial ? 6 : 8)));
    const pace = resolvePace(opts.pace || 'quick');

    const game = await new Game({
        name: opts.name || (isTutorial
            ? `Tutorial — ${displayName(humanUser)}`
            : `Bots vs ${displayName(humanUser)}`),
        size: { width: size, height: size },
        creator_id: humanUser.id || humanUser._id,
        turnTime: pace.turnTime,
        turnTimePassed: 0,
        actionsPerInterval: pace.actionsPerInterval,
        doActionQueue: false,
        doBroadcastAction: true,
        doFogOfWar: false,
        doBounty: false,
        allowAlwaysJoin: false,
        vsBots: true,
        quickMatch: pace.quickMatch,
        isTutorial,
        hasStarted: false
    }).save();

    const human = await new Player({
        user_id: humanUser.id || humanUser._id,
        game_id: game._id,
        name: opts.displayName || displayName(humanUser),
        color: '#00ffc3',
        actions: pace.startingActions,
        isBot: false
    }).save();

    const bots = [];
    for (let i = 0; i < botCount; i++) {
        bots.push(await createBotPlayer(game, i));
    }

    // Align bot starting AP with the chosen pace
    await Promise.all(bots.map(async (bot) => {
        bot.actions = pace.startingActions;
        return bot.save();
    }));

    const players = [human, ...bots];
    const locations = assignLocation(players.length, game.size);
    await Promise.all(players.map((player, i) => {
        player.position = locations[i];
        return player.save();
    }));

    game.hasStarted = true;
    game.startedAt = new Date();
    await game.save();

    // Opening move: bots take their first action so the board feels alive
    await runBotsForGame(game._id);

    return game;
}

async function thinkBot(game, bot, allPlayers) {
    // Refresh bot from list (may have been mutated)
    bot = allPlayers.find(p => sameId(p._id, bot._id)) || bot;
    if (!bot || bot.health <= 0 || (bot.actions || 0) <= 0 || !bot.position) {
        return;
    }

    const enemies = allPlayers.filter(p => p.health > 0 && !sameId(p._id, bot._id) && p.position);
    if (!enemies.length) return;

    // Attack if anyone is in range
    const inRange = enemies
        .filter(e => checkRange(bot.position, e.position, bot.range || 1))
        .sort((a, b) => a.health - b.health);

    if (inRange.length && bot.actions > 0) {
        const target = inRange[0];
        const count = Math.min(bot.actions, target.health);
        const result = await attack(game, bot, { target_id: target._id, count });
        if (result.status === 200) {
            await logAction(game, bot._id, 'attack', {
                target_id: target._id,
                count,
                killed: result.killed,
                bountyClaimed: result.bountyClaimed
            }, 'actionLog');
            // Refresh local copy after attack mutated AP/health
            const refreshed = await Player.findById(bot._id);
            const idx = allPlayers.findIndex(p => sameId(p._id, bot._id));
            if (idx >= 0 && refreshed) allPlayers[idx] = refreshed;
            const tIdx = allPlayers.findIndex(p => sameId(p._id, target._id));
            if (tIdx >= 0) {
                const tRef = await Player.findById(target._id);
                if (tRef) allPlayers[tIdx] = tRef;
            }
        }
        return;
    }

    // Sometimes upgrade range if stuck with spare AP and no target
    if (bot.actions >= 1 && (bot.range || 1) < 3 && Math.random() < 0.15) {
        const result = await upgrade(game, bot, { upgrade: 'range', count: 1 });
        if (result.status === 200) {
            await logAction(game, bot._id, 'upgrade', { upgrade: 'range', count: 1 }, 'actionLog');
            const refreshed = await Player.findById(bot._id);
            const idx = allPlayers.findIndex(p => sameId(p._id, bot._id));
            if (idx >= 0 && refreshed) allPlayers[idx] = refreshed;
        }
        return;
    }

    // Move toward nearest enemy
    const nearest = enemies.slice().sort((a, b) => {
        const da = Math.hypot(a.position.x - bot.position.x, a.position.y - bot.position.y);
        const db = Math.hypot(b.position.x - bot.position.x, b.position.y - bot.position.y);
        return da - db;
    })[0];

    const occupied = occupiedSet(allPlayers.filter(p => !sameId(p._id, bot._id)));
    const next = stepToward(bot.position, nearest.position, occupied, game);
    if (!next || bot.actions < 1) return;

    const result = await move(game, bot, { positions: [next] });
    if (result.status === 200) {
        await logAction(game, bot._id, 'move', { positions: [next] }, 'actionLog');
        const refreshed = await Player.findById(bot._id);
        const idx = allPlayers.findIndex(p => sameId(p._id, bot._id));
        if (idx >= 0 && refreshed) allPlayers[idx] = refreshed;
    }
}

/**
 * Run one AI decision for every living bot in a vs-bots game.
 * Bots spend real AP through ActionController, so they behave like players.
 */
async function runBotsForGame(gameId) {
    const game = await Game.findById(gameId);
    if (!game || !game.vsBots || !game.hasStarted) {
        return { ok: false, reason: 'not-vs-bots' };
    }

    let players = await Player.find({ game_id: game._id });
    const list = Array.isArray(players) ? players : [];
    const bots = list.filter(p => p.isBot && p.health > 0);

    for (const bot of bots) {
        // Reload list each bot so positions/AP stay consistent
        players = await Player.find({ game_id: game._id });
        const freshList = Array.isArray(players) ? players : [];
        const freshBot = freshList.find(p => sameId(p._id, bot._id));
        if (!freshBot) continue;
        // Spend up to 2 actions per think cycle so bots feel active
        const budget = Math.min(2, freshBot.actions || 0);
        for (let i = 0; i < budget; i++) {
            await thinkBot(game, freshBot, freshList);
            const again = await Player.findById(freshBot._id);
            if (!again || again.health <= 0 || (again.actions || 0) <= 0) break;
            Object.assign(freshBot, again);
        }
    }

    return { ok: true, bots: bots.length };
}

module.exports.createVsBotsGame = createVsBotsGame;
module.exports.runBotsForGame = runBotsForGame;
module.exports.thinkBot = thinkBot;

function redirectBotsError(res, isTutorial) {
    return res.redirect(isTutorial ? '/tutorial?error=true' : '/bots?error=true');
}

/** HTTP: start a fresh vs-bots match for the logged-in user. */
module.exports.startBotsMatch = async function startBotsMatch(req, res) {
    const isTutorial = !!(req.body && (req.body.isTutorial === 'true' || req.body.isTutorial === true || req.body.tutorial === 'true'));
    try {
        const botCount = req.body && req.body.botCount != null
            ? req.body.botCount
            : (isTutorial ? 2 : 3);
        const game = await createVsBotsGame(req.user, {
            botCount,
            displayName: req.body && req.body.displayName,
            size: req.body && req.body.size,
            pace: (req.body && req.body.pace) || 'quick',
            isTutorial
        });
        const id = game._id && game._id.toString ? game._id.toString() : String(game._id || game.id);
        return res.redirect(`/play?game=${id}`);
    } catch (err) {
        console.error('[bots] startBotsMatch', err);
        return redirectBotsError(res, isTutorial);
    }
};

async function guestBotsLogin(req, res, next, opts = {}) {
    const tab = opts.isTutorial ? 'tutorial' : 'bots';
    try {
        const { createGuestUser } = require('./AuthController.js');
        const user = await createGuestUser();
        req.login(user, async (err) => {
            if (err) return next(err);
            try {
                const game = await createVsBotsGame(user, {
                    botCount: opts.botCount != null ? opts.botCount : (opts.isTutorial ? 2 : 3),
                    size: opts.size,
                    pace: opts.pace || 'quick',
                    isTutorial: !!opts.isTutorial
                });
                const id = game._id && game._id.toString ? game._id.toString() : String(game._id || game.id);
                return res.redirect(`/play?game=${id}`);
            } catch (e) {
                console.error('[bots] guestBotsLogin create', e);
                return res.redirect(`/login?error=${tab}&tab=${tab}`);
            }
        });
    } catch (err) {
        console.error('[bots] guestBotsLogin', err);
        return res.redirect(`/login?error=${tab}&tab=${tab}`);
    }
}

/** Passwordless login tab → guest session + quick vs-bots match. */
module.exports.botsLoginAndPlay = async function botsLoginAndPlay(req, res, next) {
    return guestBotsLogin(req, res, next, { pace: 'quick', botCount: 3 });
};

/** Tutorial tab → guest session + guided quick match. */
module.exports.tutorialLoginAndPlay = async function tutorialLoginAndPlay(req, res, next) {
    return guestBotsLogin(req, res, next, {
        pace: 'quick',
        botCount: 2,
        size: 6,
        isTutorial: true
    });
};

module.exports.PACE = PACE;
module.exports.resolvePace = resolvePace;
