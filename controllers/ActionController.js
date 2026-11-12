const { checkRange, checkGrid, actionPointCost, UPGRADE_COST, parsePositiveInt } = require('../libs/game_utils.js')

// Router: ./routes/action_router.js

// All routes to game will have req.game and req.player
const Player = require("../models/PlayerModel.js");

function isAdjacent(pos1, pos2) {
    // Cardinal adjacency only (Manhattan distance of 1) — not diagonals or farther cells
    const dx = Math.abs(pos1.x - pos2.x);
    const dy = Math.abs(pos1.y - pos2.y);
    return dx + dy === 1;
}

function samePos(a, b) {
    return a && b && Number(a.x) === Number(b.x) && Number(a.y) === Number(b.y);
}

function sameId(a, b) {
    if (a == null || b == null) return false;
    return String(a) === String(b);
}

/**
 * Ensure the player can afford a cost before applying any side effects.
 * @param {Object} player
 * @param {number} cost
 * @param {boolean} prepaid
 * @return {{ok: boolean, message?: string}}
 */
function canAfford(player, cost, prepaid) {
    if (!Number.isFinite(cost) || cost <= 0) {
        return { ok: false, message: 'Invalid action cost' };
    }
    if (!prepaid && player.actions < cost) {
        return { ok: false, message: 'Not enough actions' };
    }
    return { ok: true };
}

/**
 *
 * @param {Object} game
 * @param {Object} player
 * @param {Object} data
 * @return {Promise<{message: string, status: number}>}
 */
async function move(game, player, data) {
    const positions = data.positions;

    if (!Array.isArray(positions) || positions.length === 0) {
        return { status: 403, message: 'Invalid positions' };
    }

    const cost = positions.length;
    const afford = canAfford(player, cost, data.prepaid);
    if (!afford.ok) {
        return { status: 403, message: afford.message };
    }

    const positionsFromPlayer = [player.position, ...positions]
    for (let i = 1; i < positionsFromPlayer.length; i++) {
        if (!isAdjacent(positionsFromPlayer[i - 1], positionsFromPlayer[i])) {
            return { status: 403, message: 'Positions not adjacent' }
        }
    }

    const finalPosition = positions[positions.length - 1]

    if (!checkGrid(finalPosition, game)) {
        return { status: 403, message: 'Out of bounds' };
    }

    // Collision: final destination must be empty within this game (exclude self)
    const playersInGame = await Player.find({ game_id: game._id });
    const collision = playersInGame.some(other =>
        !sameId(other._id, player._id) && samePos(other.position, finalPosition)
    );
    if (collision) {
        return { status: 403, message: 'Collision with another player' };
    }

    try {
        player.position.x = finalPosition.x;
        player.position.y = finalPosition.y;

        if (!data.prepaid) {
            player.actions -= cost;
        }

        await player.save();
    } catch (e) {
        return { status: 500, message: e }
    }

    return { status: 200, message: 'ok' };
}

/**
 *
 * @param {Object} game
 * @param {Object} player
 * @param {Object} data
 * @return {Promise<{message: string, status: number, killed: boolean, bountyClaimed: boolean}>}
 */
async function attack(game, player, data) {
    let targetPlayer;

    try {
        targetPlayer = await Player.findById(data.target_id);
    } catch (e) {
        return { status: 500, message: e, killed: false, bountyClaimed: false };
    }

    if (!targetPlayer) {
        return { status: 404, message: 'Target not found', killed: false, bountyClaimed: false };
    }

    const gameId = game && game._id != null ? game._id : player.game_id;
    if (!sameId(targetPlayer.game_id, gameId) && !sameId(targetPlayer.game_id, player.game_id)) {
        return { status: 403, message: 'Target not in this game', killed: false, bountyClaimed: false };
    }

    if (!checkRange(player.position, targetPlayer.position, player.range)) {
        return { status: 403, message: 'Out of bounds', killed: false, bountyClaimed: false };
    }

    const count = parsePositiveInt(data.count);
    if (count == null) {
        return { status: 403, message: 'Invalid count', killed: false, bountyClaimed: false };
    }

    const afford = canAfford(player, count, data.prepaid);
    if (!afford.ok) {
        return { status: 403, message: afford.message, killed: false, bountyClaimed: false };
    }

    try {
        if (targetPlayer.health <= 0) {
            return { status: 403, message: 'Player already dead', killed: false, bountyClaimed: false };
        }

        targetPlayer.health -= count;
        await targetPlayer.save();

        let killed = false;
        let bountyClaimed = false;

        // Killed — loot action points (and fulfill bounty if assigned)
        if (targetPlayer.health <= 0) {
            player.actions += targetPlayer.actions
            killed = true;

            if (game.doBounty && player.bounty_target && sameId(player.bounty_target, targetPlayer._id)) {
                bountyClaimed = true;
                player.bounty_target = null;
            }
        }

        if (!data.prepaid) {
            player.actions -= count;
        }
        await player.save()

        return { status: 200, message: 'ok', killed, bountyClaimed };
    } catch (e) {
        return { status: 500, message: e, killed: false, bountyClaimed: false };
    }
}

/**
 *
 * @param {Object} game
 * @param {Object} player
 * @param {Object} data
 * @return {Promise<{message: string, status: number}>}
 */
async function upgrade(game, player, data) {
    const UPGRADES = [ "range", "sight", "health" ]

    if (!UPGRADES.includes(data.upgrade)) {
        return { status: 403, message: 'Unknown upgrade' }
    }

    const count = parsePositiveInt(data.count);
    if (count == null) {
        return { status: 403, message: 'Invalid count' };
    }

    const cost = UPGRADE_COST[data.upgrade] * count;
    const afford = canAfford(player, cost, data.prepaid);
    if (!afford.ok) {
        return { status: 403, message: afford.message };
    }

    try {
        player[data.upgrade] += count;

        if (!data.prepaid) {
            player.actions -= cost;
        }

        await player.save()

        return { status: 200, message: 'ok' }
    } catch (e) {
        console.log(e)
        return { status: 500, message: e }
    }
}

/**
 *
 * @param {Object} game
 * @param {Object} player
 * @param {Object} data
 * @return {Promise<{message: string, status: number}>}
 */
async function give(game, player, data) {
    let targetPlayer;

    try {
        targetPlayer = await Player.findById(data.target_id);

        if (!targetPlayer) {
            return { status: 404, message: 'Target not found' };
        }

        const gameId = game && game._id != null ? game._id : player.game_id;
        if (!sameId(targetPlayer.game_id, gameId) && !sameId(targetPlayer.game_id, player.game_id)) {
            return { status: 403, message: 'Target not in this game' };
        }

        // giveRangeOffset < 0 means unlimited range; >= 0 adds to attack range
        if (game.giveRangeOffset != null && game.giveRangeOffset >= 0) {
            if (!checkRange(player.position, targetPlayer.position, player.range + game.giveRangeOffset)) {
                return { status: 403, message: 'Out of range' };
            }
        }

        const count = parsePositiveInt(data.count);
        if (count == null) {
            return { status: 403, message: 'Invalid count' };
        }

        const afford = canAfford(player, count, data.prepaid);
        if (!afford.ok) {
            return { status: 403, message: afford.message };
        }

        if (!data.prepaid) {
            player.actions -= count;
        }
        targetPlayer.actions += count;

        await player.save();
        await targetPlayer.save();

        return { status: 200, message: 'ok' }
    } catch (e) {
        return { status: 500, message: e };
    }
}

/**
 *
 * @param {Object} game
 * @param {string} playerId
 * @param {string} action
 * @param {Object} data
 * @param {('actions'|'actionLog')} type
 * @return {Promise<boolean>}
 */
async function logAction(game, playerId, action, data, type) {
    const entry = {
        action: action,
        player_id: playerId,
        ...data
    };

    game[type] = game[type] || [];
    game[type].push(entry)

    try {
        await game.save();
        return true;
    } catch (e) {
        game[type].pop();
        return false;
    }
}

/**
 * Reserve AP when queueing an action so players cannot over-commit.
 * Reloads the player document first to reduce lost-update races.
 * @param {Object} player
 * @param {number} cost
 * @return {Promise<{ok: boolean, message?: string}>}
 */
async function reserveActionPoints(player, cost) {
    if (!Number.isFinite(cost) || cost <= 0) {
        return { ok: false, message: 'Invalid action cost' };
    }

    const fresh = await Player.findById(player._id);
    if (!fresh) {
        return { ok: false, message: 'Player not found' };
    }
    if (fresh.actions < cost) {
        return { ok: false, message: 'Not enough actions' };
    }

    fresh.actions -= cost;
    await fresh.save();
    player.actions = fresh.actions;
    return { ok: true };
}

async function queueAction(req, res, action, data) {
    const cost = actionPointCost(action, data);
    if (!Number.isFinite(cost) || cost <= 0) {
        return res.status(403).send('Invalid action cost');
    }

    // Snapshot AP so a failed log can refund even if another request mutated the object
    const reserved = await reserveActionPoints(req.player, cost);

    if (!reserved.ok) {
        return res.status(403).send(reserved.message);
    }

    // Reload game before appending to reduce lost queue entries under concurrency
    try {
        const Game = require('../models/GameModel.js');
        const freshGame = await Game.findById(req.game._id);
        if (freshGame) {
            req.game = freshGame;
        }
    } catch (_) {
        // keep req.game
    }

    const success = await logAction(req.game, req.player._id, action, data, 'actions');

    if (success) {
        res.status(200).send('ok');
    } else {
        // Refund reserved points if logging failed
        const fresh = await Player.findById(req.player._id);
        if (fresh) {
            fresh.actions += cost;
            await fresh.save();
            req.player.actions = fresh.actions;
        }
        res.status(500).send();
    }
}

async function moveReq(req, res) {
    if (!req.game.doActionQueue) {
        const result = await move(req.game, req.player, req.body);

        if (result.status === 200) {
            await logAction(req.game, req.player._id, 'move', req.body, 'actionLog')
        }

        if (result.status !== 200) console.log(result.message)
        res.status(result.status).send(result.message)
    } else {
        await queueAction(req, res, 'move', req.body);
    }
}

async function attackReq(req, res) {
    const data = { target_id: req.params.targetId, count: req.params.count };

    if (!req.game.doActionQueue) {
        const result = await attack(req.game, req.player, data)

        if (result.status === 200) {
            await logAction(req.game, req.player._id, 'attack', {
                target_id: req.params.targetId,
                killed: result.killed,
                bountyClaimed: result.bountyClaimed,
                count: req.params.count
            }, 'actionLog')
        }

        res.status(result.status).send(result.message)
    } else {
        await queueAction(req, res, 'attack', data);
    }
}

async function upgradeReq(req, res) {
    const data = { upgrade: req.params.upgrade, count: req.params.count };

    if (!req.game.doActionQueue) {
        const result = await upgrade(req.game, req.player, data);

        if (result.status === 200) {
            await logAction(req.game, req.player._id, 'upgrade', data, 'actionLog')
        }

        res.status(result.status).send(result.message)
    } else {
        await queueAction(req, res, 'upgrade', data);
    }
}

async function giveReq(req, res) {
    const data = { target_id: req.params.targetId, count: req.params.count };

    if (!req.game.doActionQueue) {
        const result = await give(req.game, req.player, data);

        if (result.status === 200) {
            await logAction(req.game, req.player._id, 'give', data, 'actionLog')
        }

        res.status(result.status).send(result.message)
    } else {
        await queueAction(req, res, 'give', data);
    }
}



// Player controller
async function voteReq(req, res) {
    voteReq.VOTE_TYPES = {
        JURY: 'vote_jury'
    }

    voteReq.voteTypeError = "Unknown voting type!"
    voteReq.playerDeadError = "Voting player not dead or voted player already dead!"
    voteReq.playerNotFoundError = "Player not found!"

    const player = req.player;
    const voteType = req.params.vote;

    if (!Object.values(voteReq.VOTE_TYPES).includes(voteType)) {
        console.log(voteReq.voteTypeError + ": " + voteType)
        return res.status(403).send(voteReq.voteTypeError);
    }

    // Check if player id is valid
    let votedPlayer;
    try {
        votedPlayer = await Player.findById(req.params.playerId)

        if (!votedPlayer || !sameId(votedPlayer.game_id, req.game._id)) {
            console.log(voteReq.playerNotFoundError);
            return res.status(403).send(voteReq.playerNotFoundError);
        }

        if (votedPlayer.health <= 0 || player.health > 0) {
            console.log(voteReq.playerDeadError);
            return res.status(403).send(voteReq.playerDeadError)
        }

    } catch (e) {
        console.log(e)
        return res.status(501).send(e)
    }

    player[voteType] = votedPlayer._id;

    try {
        await player.save();
        res.status(200).send()
    } catch (e) {
        console.log(e)
        res.status(501).send(e)
    }
}

async function patchColorReq(req, res) {
    const player = req.player
    const color = req.params.color;

    if (!require('validate-color').validateHTMLColor(color)) {
        return res.status(403).send()
    }

    player.color = color;

    try {
        await player.save();
        res.status(200).send()
    } catch (e) {
        res.status(501).send(e)
    }
}

module.exports = {
    move,
    attack,
    upgrade,
    give,
    logAction,
    reserveActionPoints,
    canAfford,

    moveReq,
    attackReq,
    upgradeReq,
    giveReq,

    voteReq,

    patchColorReq,

    isAdjacent
}
