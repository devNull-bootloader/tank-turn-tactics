const { checkRange, checkGrid, actionPointCost, UPGRADE_COST } = require('../libs/game_utils.js')

// Router: ./routes/action_router.js

// All routes to game will have req.game and req.player
const Player = require("../models/PlayerModel.js");

function isAdjacent(pos1, pos2) {
    // Cardinal adjacency only (Manhattan distance of 1) — not diagonals or farther cells
    const dx = Math.abs(pos1.x - pos2.x);
    const dy = Math.abs(pos1.y - pos2.y);
    return dx + dy === 1;
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

    if (!data.prepaid && positions.length > player.actions) {
        return { status: 403, message: 'Not enough actions' }
    }

    const positionsFromPlayer = [player.position, ...positions]
    for (let i = 1; i < positionsFromPlayer.length; i++) {
        if (!isAdjacent(positionsFromPlayer[i - 1], positionsFromPlayer[i])) {
            return { status: 403, message: 'Positions not adjacent' }
        }
    }

    const finalPosition = positions[positions.length - 1]

    if (checkGrid(finalPosition, game)) {
        if ((await Player.find({ position: positions })).length !== 0) {
            return { status: 403, message: 'Collision with another player' };
        }

        try {
            player.position.x = finalPosition.x;
            player.position.y = finalPosition.y;

            if (!data.prepaid) {
                player.actions -= positions.length;

                if (player.actions < 0) {
                    return { status: 403, message: 'Not enough actions' }
                }
            }

            await player.save();
        } catch (e) {
            return { status: 500, message: e }
        }

        return { status: 200, message: 'ok' };
    } else {
        return { status: 403, message: 'Out of bounds' };
    }
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

    if (!checkRange(player.position, targetPlayer.position, player.range)) {
        return { status: 403, message: 'Out of bounds', killed: false, bountyClaimed: false };
    }

    try {
        if (targetPlayer.health <= 0) return { status: 500, message: 'Player already dead', killed: false, bountyClaimed: false }

        const count = parseInt(data.count, 10);
        targetPlayer.health -= count;
        await targetPlayer.save();

        let killed = false;
        let bountyClaimed = false;

        // Killed — loot action points (and fulfill bounty if assigned)
        if (targetPlayer.health <= 0) {
            player.actions += targetPlayer.actions
            killed = true;

            if (game.doBounty && player.bounty_target && player.bounty_target.equals(targetPlayer._id)) {
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
        await targetPlayer.updateOne(targetPlayer)
        await player.updateOne(player)

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

    try {
        const count = parseInt(data.count, 10);
        player[data.upgrade] += count;

        if (!data.prepaid) {
            player.actions -= UPGRADE_COST[data.upgrade] * count;

            if (player.actions < 0) {
                return { status: 501, message: "Not enough energy" }
            }
        }

        await player.save()

        return { status: 200, message: 'ok' }
    } catch (e) {
        console.log(e)
        return { status: 501, message: e }
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

        if (game.giveRangeOffset && game.giveRangeOffset >= 0) {
            if (!checkRange(player.position, targetPlayer.position, player.range + game.giveRangeOffset)) {
                return { status: 500, message: 'Out of range' };
            }
        }

        const count = parseInt(data.count, 10);

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
    game[type].push({
        action: action,
        player_id: playerId,
        ...data
    })

    try {
        await game.save();

        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Reserve AP when queueing an action so players cannot over-commit.
 * @param {Object} player
 * @param {number} cost
 * @return {Promise<{ok: boolean, message?: string}>}
 */
async function reserveActionPoints(player, cost) {
    if (cost <= 0) {
        return { ok: false, message: 'Invalid action cost' };
    }
    if (player.actions < cost) {
        return { ok: false, message: 'Not enough actions' };
    }

    player.actions -= cost;
    await player.save();
    return { ok: true };
}

async function queueAction(req, res, action, data) {
    const cost = actionPointCost(action, data);
    const reserved = await reserveActionPoints(req.player, cost);

    if (!reserved.ok) {
        return res.status(403).send(reserved.message);
    }

    const success = await logAction(req.game, req.player._id, action, data, 'actions');

    if (success) {
        res.status(200).send('ok');
    } else {
        // Refund reserved points if logging failed
        req.player.actions += cost;
        await req.player.save();
        res.status(500).send();
    }
}

async function moveReq(req, res) {
    if (!req.game.doActionQueue) {
        const result = await move(req.game, req.player, req.body);

        await logAction(req.game, req.player._id, 'move', req.body, 'actionLog')

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

        await logAction(req.game, req.player._id, 'attack', {
            target_id: req.params.targetId,
            killed: result.killed,
            bountyClaimed: result.bountyClaimed,
            count: req.params.count
        }, 'actionLog')

        res.status(result.status).send(result.message)
    } else {
        await queueAction(req, res, 'attack', data);
    }
}

async function upgradeReq(req, res) {
    const data = { upgrade: req.params.upgrade, count: req.params.count };

    if (!req.game.doActionQueue) {
        const result = await upgrade(req.game, req.player, data);

        await logAction(req.game, req.player._id, 'upgrade', data, 'actionLog')

        res.status(result.status).send(result.message)
    } else {
        await queueAction(req, res, 'upgrade', data);
    }
}

async function giveReq(req, res) {
    const data = { target_id: req.params.targetId, count: req.params.count };

    if (!req.game.doActionQueue) {
        const result = await give(req.game, req.player, data);

        await logAction(req.game, req.player._id, 'give', data, 'actionLog')

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

        if (!votedPlayer || !votedPlayer.game_id.equals(req.game._id)) {
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

    moveReq,
    attackReq,
    upgradeReq,
    giveReq,

    voteReq,

    patchColorReq,

    isAdjacent
}
