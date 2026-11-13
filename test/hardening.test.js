const DBHandler = require('./db_handler');
const mongoose = require('mongoose');
const { getMockRes } = require('@jest-mock/express');
const Game = require('../models/GameModel.js');
const Player = require('../models/PlayerModel.js');
const { attack, give, move, upgrade, attackReq, moveReq } = require('../controllers/ActionController.js');
const { parsePositiveInt, actionPointCost } = require('../libs/game_utils.js');
const { getGame } = require('../controllers/GameController.js');
const { performActions } = require('../config/game_runner.js');

DBHandler.setup();

describe('Hardening', () => {
    describe('parsePositiveInt / actionPointCost', () => {
        it('rejects invalid counts', () => {
            expect(parsePositiveInt(-1)).toBeNull();
            expect(parsePositiveInt(0)).toBeNull();
            expect(parsePositiveInt('abc')).toBeNull();
            expect(parsePositiveInt(1.5)).toBeNull();
            expect(parsePositiveInt(1001)).toBeNull();
            expect(parsePositiveInt(3)).toBe(3);
        });

        it('returns zero cost for invalid upgrade/attack payloads', () => {
            expect(actionPointCost('attack', { count: -5 })).toBe(0);
            expect(actionPointCost('give', { count: 'nope' })).toBe(0);
            expect(actionPointCost('upgrade', { upgrade: 'range', count: 0 })).toBe(0);
            expect(actionPointCost('move', { positions: [] })).toBe(0);
        });
    });

    describe('AP overspend prevention', () => {
        it('blocks attack when count exceeds available actions', async () => {
            const game = await new Game({
                name: 'atk',
                size: { width: 10, height: 10 },
                creator_id: mongoose.Types.ObjectId(),
                doActionQueue: false
            }).save();

            const attacker = await new Player({
                name: 'A',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 0, y: 0 },
                range: 5,
                actions: 1,
                health: 3
            }).save();

            const target = await new Player({
                name: 'B',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 1, y: 0 },
                health: 3
            }).save();

            const result = await attack(game, attacker, { target_id: target._id, count: 3 });
            expect(result.status).toBe(403);

            const refreshedTarget = await Player.findById(target._id);
            const refreshedAttacker = await Player.findById(attacker._id);
            expect(refreshedTarget.health).toBe(3);
            expect(refreshedAttacker.actions).toBe(1);
        });

        it('blocks give when count exceeds available actions', async () => {
            const game = await new Game({
                name: 'give',
                size: { width: 10, height: 10 },
                creator_id: mongoose.Types.ObjectId(),
                giveRangeOffset: -1
            }).save();

            const giver = await new Player({
                name: 'A',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 0, y: 0 },
                actions: 2,
                health: 3
            }).save();

            const receiver = await new Player({
                name: 'B',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 5, y: 5 },
                actions: 0,
                health: 3
            }).save();

            const result = await give(game, giver, { target_id: receiver._id, count: 5 });
            expect(result.status).toBe(403);

            const refreshedGiver = await Player.findById(giver._id);
            const refreshedReceiver = await Player.findById(receiver._id);
            expect(refreshedGiver.actions).toBe(2);
            expect(refreshedReceiver.actions).toBe(0);
        });

        it('blocks upgrade when energy is insufficient', async () => {
            const game = await new Game({
                name: 'up',
                size: { width: 5, height: 5 },
                creator_id: mongoose.Types.ObjectId()
            }).save();

            const player = await new Player({
                name: 'A',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 0, y: 0 },
                actions: 1,
                health: 3,
                range: 1
            }).save();

            const result = await upgrade(game, player, { upgrade: 'health', count: 1 });
            expect(result.status).toBe(403);

            const refreshed = await Player.findById(player._id);
            expect(refreshed.health).toBe(3);
            expect(refreshed.actions).toBe(1);
        });

        it('rejects NaN / negative counts on attack route', async () => {
            const game = {
                _id: mongoose.Types.ObjectId(),
                doActionQueue: false,
                size: { width: 10, height: 10 },
                actionLog: [],
                save: async function () { return this; }
            };

            const target = await new Player({
                name: 'B',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 1, y: 0 },
                health: 3
            }).save();

            const attacker = await new Player({
                name: 'A',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 0, y: 0 },
                range: 3,
                actions: 5,
                health: 3
            }).save();

            const { res } = getMockRes();
            await attackReq({
                game,
                player: attacker,
                params: { targetId: target._id, count: '-2' }
            }, res);

            expect(res.status).toHaveBeenCalledWith(403);
            const refreshed = await Player.findById(target._id);
            expect(refreshed.health).toBe(3);
        });
    });

    describe('move collision', () => {
        it('detects collision on the final cell in the same game', async () => {
            const game = await new Game({
                name: 'col',
                size: { width: 10, height: 10 },
                creator_id: mongoose.Types.ObjectId()
            }).save();

            const mover = await new Player({
                name: 'A',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 0, y: 0 },
                actions: 3,
                health: 3
            }).save();

            await new Player({
                name: 'B',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 1, y: 0 },
                health: 3
            }).save();

            const result = await move(game, mover, {
                positions: [{ x: 1, y: 0 }]
            });
            expect(result.status).toBe(403);
            expect(result.message).toMatch(/Collision/i);

            const refreshed = await Player.findById(mover._id);
            expect(refreshed.position.x).toBe(0);
            expect(refreshed.position.y).toBe(0);
        });

        it('ignores players in other games at the same coordinates', async () => {
            const game = await new Game({
                name: 'col2',
                size: { width: 10, height: 10 },
                creator_id: mongoose.Types.ObjectId()
            }).save();
            const otherGame = await new Game({
                name: 'other',
                size: { width: 10, height: 10 },
                creator_id: mongoose.Types.ObjectId()
            }).save();

            const mover = await new Player({
                name: 'A',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 0, y: 0 },
                actions: 3,
                health: 3
            }).save();

            await new Player({
                name: 'Other',
                game_id: otherGame._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 1, y: 0 },
                health: 3
            }).save();

            const result = await move(game, mover, {
                positions: [{ x: 1, y: 0 }]
            });
            expect(result.status).toBe(200);

            const refreshed = await Player.findById(mover._id);
            expect(refreshed.position.x).toBe(1);
        });
    });

    describe('fog action log privacy', () => {
        it('filters actionLog entries for tanks outside sight', async () => {
            const userId = mongoose.Types.ObjectId();
            const farUser = mongoose.Types.ObjectId();

            const game = await new Game({
                name: 'fog-log',
                size: { width: 20, height: 20 },
                creator_id: userId,
                doFogOfWar: true,
                hasStarted: true,
                actionLog: []
            }).save();

            const viewer = await new Player({
                name: 'Viewer',
                game_id: game._id,
                user_id: userId,
                position: { x: 0, y: 0 },
                sight: 1,
                health: 3
            }).save();

            const near = await new Player({
                name: 'Near',
                game_id: game._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 1, y: 0 },
                health: 3
            }).save();

            const far = await new Player({
                name: 'Far',
                game_id: game._id,
                user_id: farUser,
                position: { x: 15, y: 15 },
                health: 3
            }).save();

            game.actionLog = [
                { action: 'move', player_id: viewer._id, positions: [{ x: 0, y: 1 }] },
                { action: 'attack', player_id: near._id, target_id: viewer._id, count: 1 },
                { action: 'attack', player_id: far._id, target_id: far._id, count: 1 },
                { action: 'vote', vote: 'jury', vote_tied: true }
            ];
            await game.save();

            const dto = await getGame(game._id, userId);
            const actions = dto.actionLog.map(a => a.action + ':' + String(a.player_id || a.vote));
            expect(actions.some(a => a.startsWith('move:'))).toBe(true);
            expect(actions.some(a => a.startsWith('attack:') && a.includes(String(near._id)))).toBe(true);
            expect(actions.some(a => a.includes(String(far._id)))).toBe(false);
            expect(actions.some(a => a.startsWith('vote:'))).toBe(true);
        });
    });

    describe('scheduler isolation', () => {
        it('continues processing other games when one performActions throws', async () => {
            const good = await new Game({
                name: 'good',
                size: { width: 5, height: 5 },
                creator_id: mongoose.Types.ObjectId(),
                hasStarted: true,
                turnTime: 1,
                turnTimePassed: 1,
                actionsPerInterval: 1,
                doActionQueue: false
            }).save();

            const player = await new Player({
                name: 'P',
                game_id: good._id,
                user_id: mongoose.Types.ObjectId(),
                position: { x: 0, y: 0 },
                actions: 0,
                health: 3
            }).save();

            const badGame = {
                _id: 'bad',
                hasStarted: true,
                turnTime: 1,
                turnTimePassed: 1
            };

            // Simulate the isolated map used by the cron
            const results = await Promise.all([badGame, good].map(async (game) => {
                try {
                    if (game._id === 'bad') throw new Error('boom');
                    await performActions(game);
                    return 'ok';
                } catch (e) {
                    return 'err';
                }
            }));

            expect(results).toEqual(['err', 'ok']);
            const refreshed = await Player.findById(player._id);
            expect(refreshed.actions).toBe(1);
        });
    });
});
