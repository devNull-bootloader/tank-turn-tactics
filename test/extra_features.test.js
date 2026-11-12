const DBHandler = require('./db_handler');
const mongoose = require('mongoose');
const Game = require('../models/GameModel.js');
const Player = require('../models/PlayerModel.js');
const { getGame } = require('../controllers/GameController.js');
const { doActionQueue, distributeActions } = require('../config/game_runner.js');
const { assignBounties, coerceBoolean, actionPointCost } = require('../libs/game_utils.js');

DBHandler.setup();

describe('Extra features', () => {
    describe('assignBounties', () => {
        it('assigns each alive player a different alive bounty target', async () => {
            const game = await new Game({
                name: 'bounty',
                size: { width: 10, height: 10 },
                creator_id: mongoose.Types.ObjectId(),
                doBounty: true
            }).save();

            const players = await Promise.all([1, 2, 3].map(i => new Player({
                name: 'P' + i,
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: i, y: 0 },
                health: 3
            }).save()));

            await assignBounties(players);

            const refreshed = await Player.find({ game_id: game._id });
            refreshed.forEach(p => {
                expect(p.bounty_target).toBeTruthy();
                expect(p.bounty_target.equals(p._id)).toBe(false);
            });
        });
    });

    describe('fog of war + spying visibility', () => {
        it('hides out-of-sight alive players when fog is enabled', async () => {
            const userId = mongoose.Types.ObjectId();
            const game = await new Game({
                name: 'fog',
                size: { width: 20, height: 20 },
                creator_id: userId,
                doFogOfWar: true,
                hasStarted: true
            }).save();

            await new Player({
                name: 'Viewer',
                game_id: game._id,
                user_id: userId,
                position: { x: 0, y: 0 },
                sight: 1,
                health: 3
            }).save();

            await new Player({
                name: 'Nearby',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 1, y: 0 },
                health: 3
            }).save();

            await new Player({
                name: 'Far',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 10, y: 10 },
                health: 3
            }).save();

            const result = await getGame(game._id, userId);
            const names = result.players.map(p => p.name).sort();

            expect(names).toEqual(['Nearby', 'Viewer']);
        });

        it('hides other players queued actions when broadcast is off', async () => {
            const userId = mongoose.Types.ObjectId();
            const otherUser = mongoose.Types.ObjectId();
            const game = await new Game({
                name: 'spy',
                size: { width: 10, height: 10 },
                creator_id: userId,
                doActionQueue: true,
                doBroadcastAction: false,
                hasStarted: true,
                actions: []
            }).save();

            const viewer = await new Player({
                name: 'Viewer',
                game_id: game._id,
                user_id: userId,
                position: { x: 0, y: 0 },
                health: 3
            }).save();

            const other = await new Player({
                name: 'Other',
                game_id: game._id,
                user_id: otherUser,
                position: { x: 2, y: 2 },
                health: 3
            }).save();

            game.actions.push(
                { action: 'move', player_id: viewer._id, positions: [{ x: 1, y: 0 }] },
                { action: 'move', player_id: other._id, positions: [{ x: 3, y: 2 }] }
            );
            await game.save();

            const result = await getGame(game._id, userId);
            expect(result.actions).toHaveLength(1);
            expect(String(result.actions[0].player_id)).toBe(String(viewer._id));
        });

        it('shows all queued actions when broadcast/spying is on', async () => {
            const userId = mongoose.Types.ObjectId();
            const game = await new Game({
                name: 'spy-on',
                size: { width: 10, height: 10 },
                creator_id: userId,
                doActionQueue: true,
                doBroadcastAction: true,
                hasStarted: true,
                actions: []
            }).save();

            const viewer = await new Player({
                name: 'Viewer',
                game_id: game._id,
                user_id: userId,
                position: { x: 0, y: 0 },
                health: 3
            }).save();

            const other = await new Player({
                name: 'Other',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 2, y: 2 },
                health: 3
            }).save();

            game.actions.push(
                { action: 'move', player_id: viewer._id, positions: [{ x: 1, y: 0 }] },
                { action: 'move', player_id: other._id, positions: [{ x: 3, y: 2 }] }
            );
            await game.save();

            const result = await getGame(game._id, userId);
            expect(result.actions).toHaveLength(2);
        });
    });

    describe('action queue resolution', () => {
        it('resolves queued moves at end of day and writes actionLog', async () => {
            const game = await new Game({
                name: 'queue-resolve',
                size: { width: 10, height: 10 },
                creator_id: mongoose.Types.ObjectId(),
                doActionQueue: true,
                turnTime: 1,
                turnTimePassed: 1,
                actionsPerInterval: 1,
                actions: [],
                actionLog: []
            }).save();

            const player = await new Player({
                name: 'Mover',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 0, y: 0 },
                actions: 0,
                health: 3
            }).save();

            game.actions.push({
                action: 'move',
                player_id: player._id,
                positions: [{ x: 1, y: 0 }]
            });
            await game.save();

            const players = await Player.find({ game_id: game._id });
            await doActionQueue(game, players);

            const moved = await Player.findById(player._id);
            const refreshedGame = await Game.findById(game._id);

            expect(moved.position.x).toBe(1);
            expect(refreshedGame.actions).toHaveLength(0);
            expect(refreshedGame.actionLog.some(a => a.action === 'move')).toBe(true);
        });

        it('grants interval actions after resolving the queue on day rollover', async () => {
            const game = await new Game({
                name: 'day-roll',
                size: { width: 10, height: 10 },
                creator_id: mongoose.Types.ObjectId(),
                doActionQueue: true,
                doBounty: false,
                turnTime: 1,
                turnTimePassed: 1,
                actionsPerInterval: 2,
                actions: [],
                actionLog: []
            }).save();

            const player = await new Player({
                name: 'P',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 0, y: 0 },
                actions: 1,
                health: 3
            }).save();

            await distributeActions(game, [player]);

            const refreshed = await Player.findById(player._id);
            expect(refreshed.actions).toBe(3);
            expect(game.turnTimePassed).toBe(1);
        });
    });

    describe('helpers', () => {
        it('coerces form boolean values', () => {
            expect(coerceBoolean('true')).toBe(true);
            expect(coerceBoolean('false')).toBe(false);
            expect(coerceBoolean(undefined, true)).toBe(true);
            expect(coerceBoolean('on')).toBe(true);
        });

        it('computes action point costs', () => {
            expect(actionPointCost('move', { positions: [{ x: 1, y: 0 }, { x: 2, y: 0 }] })).toBe(2);
            expect(actionPointCost('attack', { count: 3 })).toBe(3);
            expect(actionPointCost('upgrade', { upgrade: 'health', count: 2 })).toBe(4);
            expect(actionPointCost('upgrade', { upgrade: 'sight', count: 1 })).toBe(1);
        });
    });
});
