const schedule = require('node-schedule');
const Game = require('../models/GameModel.js')
const Player = require('../models/PlayerModel.js')
const actionFunctions = require('../controllers/ActionController.js')
const { deleteGame } = require("../controllers/GameController.js");
const { assignBounties, actionPointCost } = require('../libs/game_utils.js');

let cronString = '0 * * * *';

// Quick bots matches tick on a short interval so AP regenerates in-session.
// Human multiplayer still uses the hourly (or INTERVAL_MODE) cron below.
const QUICK_TICK_MS = Number(process.env.QUICK_TICK_MS) || 15000;

if (process.env.INTERVAL_MODE) {
    if (process.env.INTERVAL_MODE === 'minute') {
        cronString = '0 * * * * *';
        console.log('[app] Running on minute interval mode')
    }
}

async function runSchedulerPass(filter = {}) {
    const allGames = await Game.find({ hasStarted: true, ...filter });

    console.log(`[app] Actions distributed! (${Object.keys(filter).length ? 'quick' : 'cron'}) - ` + new Date());
    await Promise.all(allGames.map(async (game) => {
        try {
            await performActions(game);
        } catch (err) {
            console.error(`[app] Failed processing game ${game && game._id}:`, err);
        }
    }));

    return allGames;
}

// Avoid starting the cron while unit tests import helpers from this module
if (!process.env.JEST_WORKER_ID) {
    schedule.scheduleJob(cronString, async function() {
        // Hourly/minute pass for normal human multiplayer (and classic bots).
        // Skip quickMatch vs-bots — those are handled by the seconds timer.
        const allGames = await Game.find({ hasStarted: true });
        const cronGames = (Array.isArray(allGames) ? allGames : []).filter(g => !(g.vsBots && g.quickMatch));

        console.log("[app] Actions distributed! (cron) - " + new Date());
        await Promise.all(cronGames.map(async (game) => {
            try {
                await performActions(game);
            } catch (err) {
                console.error(`[app] Failed processing game ${game && game._id}:`, err);
            }
        }));

        // Remove old games
        for (let i = 0; i < cronGames.length; i++) {
            const game = cronGames[i];
            try {
                const players = await Player.find({ game_id: game._id })

                if (players.filter(p => p.health > 0).length <= 1 && (new Date() - new Date(game.updatedAt) > (1000 * 60 * 60 * 24))) {
                    await deleteGame(game._id)
                }
            } catch (err) {
                console.error(`[app] Failed cleanup for game ${game && game._id}:`, err);
            }
        }
    });

    setInterval(async () => {
        try {
            const allGames = await Game.find({ hasStarted: true });
            const quickGames = (Array.isArray(allGames) ? allGames : []).filter(g => g.vsBots && g.quickMatch);
            if (!quickGames.length) return;

            await Promise.all(quickGames.map(async (game) => {
                try {
                    await performActions(game);
                } catch (err) {
                    console.error(`[app] Quick tick failed for ${game && game._id}:`, err);
                }
            }));
        } catch (err) {
            console.error('[app] Quick match scheduler failed:', err);
        }
    }, QUICK_TICK_MS);

    console.log(`[app] Quick bots tick every ${QUICK_TICK_MS}ms`)
}

async function performActions(game) {
    const players = await Player.find({ game_id: game._id });

    await distributeActions(game, players)

    await game.save();

    // Vs-bots matches: after the clock tick / AP grant, bots spend like humans
    if (game.vsBots) {
        try {
            const { runBotsForGame } = require('../controllers/BotController.js');
            await runBotsForGame(game._id);
        } catch (err) {
            console.error(`[app] Bot think failed for ${game && game._id}:`, err);
        }
    }
}

async function distributeActions(game, players) {
    if (game.turnTimePassed >= game.turnTime) {
        game.turnTimePassed = 1;

        let currentPlayers = players;

        // End of day: resolve queued actions first, then votes / bounties / AP grants
        if (game.doActionQueue) {
            await doActionQueue(game, currentPlayers)
            // Refresh players after queue mutations
            currentPlayers = await Player.find({ game_id: game._id });
        }

        await calculateVotes(game, currentPlayers)

        if (game.doBounty) {
            await assignBounties(currentPlayers)
        }

        await Promise.all(currentPlayers.map(async player => {
            player.actions += game.actionsPerInterval;
            await player.save()
        }))
    } else {
        game.turnTimePassed++;
    }
}

async function calculateVotes(game, players) {
    const alivePlayers = players.filter(p => p.health > 0 )
    const deadPlayers = players.filter(p => p.health <= 0 )

    const VOTE_TYPES = ["vote_jury"]

    for (const voteType of VOTE_TYPES) {
        const votes = {}

        alivePlayers.forEach(p => votes[p._id.toString()] = 0)

        let maxVotes = 0;
        let maxPlayerId = null;
        let tied = false;

        for (const voter of deadPlayers) {
            let votedPlayerId = voter[voteType]

            if (votedPlayerId) {
                votedPlayerId = votedPlayerId.toString()
                votes[votedPlayerId]++;

                if (votes[votedPlayerId] >= maxVotes) {
                    tied = votes[votedPlayerId] === maxVotes

                    maxPlayerId = votedPlayerId
                    maxVotes = votes[votedPlayerId]
                }

                voter[voteType] = null;
                await voter.save();
            }
        }

        if (tied) {
            game.actionLog.push({
                action: 'vote',
                vote: 'jury',
                vote_tied: true
            })
            await game.save()
            console.log("Votes tied")
        } else if (maxPlayerId) {
            const winner = alivePlayers.find(p => p._id.toString() === maxPlayerId)
            try {
                winner.actions++;
                await winner.save()

                game.actionLog.push({
                    action: 'vote',
                    vote: 'jury',
                    vote_tied: false,
                    target_id: winner._id
                })
                await game.save()

                console.log("Jury has awarded points to " + winner.name)
            } catch (e) {
                console.log(e)
            }
        }
    }
}

async function doActionQueue(game, players) {
    const actions = [...(game.actions || [])];

    const ACTIONS_ORDER = ['give', 'attack', 'move', 'upgrade']

    const sortedActions = []

    // Order action by filtering
    ACTIONS_ORDER.forEach(actionName => {
        sortedActions.push(...actions.filter(action => action.action === actionName))
    })

    for (const action of sortedActions) {
        const player = players.find(player => player && player._id.equals(action.player_id));
        if (!player) {
            continue;
        }

        const payload = {
            ...action.toObject ? action.toObject() : action,
            prepaid: true
        };

        const result = await actionFunctions[action.action](game, player, payload)
        if (result.status !== 200) {
            // Refund reserved AP if the queued action could not resolve
            const cost = actionPointCost(action.action, payload);
            player.actions += cost;
            await player.save();
            console.log(result.message)
            continue;
        }

        const logData = {
            target_id: action.target_id,
            count: action.count,
            positions: action.positions,
            upgrade: action.upgrade,
            killed: result.killed,
            bountyClaimed: result.bountyClaimed
        };

        await actionFunctions.logAction(game, player._id, action.action, logData, 'actionLog');
    }

    game.actions = [];
    await game.save();
}

module.exports.performActions = performActions;
module.exports.doActionQueue = doActionQueue;
module.exports.distributeActions = distributeActions;
module.exports.QUICK_TICK_MS = QUICK_TICK_MS;
module.exports.runSchedulerPass = runSchedulerPass;
