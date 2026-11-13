const DBHandler = require('./db_handler');
const mongoose = require('mongoose');
const Game = require('../models/GameModel.js');
const Player = require('../models/PlayerModel.js');
const User = require('../models/UserModel.js');
const { createDebugUser, createGuestUser } = require('../controllers/AuthController.js');
const { performActions } = require('../config/game_runner.js');
const DebugController = require('../controllers/DebugController.js');

DBHandler.setup();

function mockRes() {
    const res = {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        send(payload) {
            this.body = payload;
            return this;
        }
    };
    return res;
}

describe('Debug panel', () => {
    it('creates a debug user with debug flag but not admin', async () => {
        const user = await createDebugUser();
        expect(user.debug).toBe(true);
        expect(!!user.admin).toBe(false);
        expect(user.guest).toBe(false);
        expect(String(user.username)).toMatch(/^debug_/);
    });

    it('guest users are not debug users', async () => {
        const guest = await createGuestUser();
        expect(guest.guest).toBe(true);
        expect(!!guest.debug).toBe(false);
    });

    it('forceRound resolves the day and resets turn progress', async () => {
        const creator = new mongoose.Types.ObjectId();
        const game = await new Game({
            name: 'debug-round',
            size: { width: 8, height: 8 },
            creator_id: creator,
            hasStarted: true,
            turnTime: 24,
            turnTimePassed: 10,
            actionsPerInterval: 1,
            doActionQueue: false,
            doBounty: false
        }).save();

        const p1 = await new Player({
            name: 'A',
            game_id: game._id,
            user_id: new mongoose.Types.ObjectId(),
            position: { x: 0, y: 0 },
            health: 3,
            actions: 0
        }).save();

        await new Player({
            name: 'B',
            game_id: game._id,
            user_id: new mongoose.Types.ObjectId(),
            position: { x: 2, y: 0 },
            health: 3,
            actions: 0
        }).save();

        const req = { params: { gameId: game._id.toString() }, body: {} };
        const res = mockRes();
        await DebugController.forceRound(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.turnTimePassed).toBe(1);

        const refreshed = await Player.findById(p1._id);
        expect(refreshed.actions).toBe(1);
    });

    it('tickGame advances turnTimePassed by one when mid-round', async () => {
        const game = await new Game({
            name: 'debug-tick',
            size: { width: 6, height: 6 },
            creator_id: new mongoose.Types.ObjectId(),
            hasStarted: true,
            turnTime: 24,
            turnTimePassed: 3,
            actionsPerInterval: 1,
            doBounty: false
        }).save();

        await new Player({
            name: 'Solo',
            game_id: game._id,
            user_id: new mongoose.Types.ObjectId(),
            position: { x: 1, y: 1 },
            health: 3,
            actions: 2
        }).save();

        const req = { params: { gameId: game._id.toString() }, body: {} };
        const res = mockRes();
        await DebugController.tickGame(req, res);

        expect(res.body.ok).toBe(true);
        expect(res.body.turnTimePassed).toBe(4);
    });

    it('grantAp adds energy to living players only', async () => {
        const game = await new Game({
            name: 'debug-ap',
            size: { width: 6, height: 6 },
            creator_id: new mongoose.Types.ObjectId(),
            hasStarted: true
        }).save();

        const alive = await new Player({
            name: 'Alive',
            game_id: game._id,
            user_id: new mongoose.Types.ObjectId(),
            position: { x: 0, y: 0 },
            health: 2,
            actions: 1
        }).save();

        const dead = await new Player({
            name: 'Dead',
            game_id: game._id,
            user_id: new mongoose.Types.ObjectId(),
            position: { x: 1, y: 0 },
            health: 0,
            actions: 4
        }).save();

        const req = { params: { gameId: game._id.toString() }, body: { amount: 3 } };
        const res = mockRes();
        await DebugController.grantAp(req, res);

        expect(res.body.ok).toBe(true);
        expect((await Player.findById(alive._id)).actions).toBe(4);
        expect((await Player.findById(dead._id)).actions).toBe(4);
    });

    it('performActions is still used by tick helper path', async () => {
        const game = await new Game({
            name: 'debug-pa',
            size: { width: 5, height: 5 },
            creator_id: new mongoose.Types.ObjectId(),
            hasStarted: true,
            turnTime: 2,
            turnTimePassed: 2,
            actionsPerInterval: 2,
            doBounty: false
        }).save();

        const player = await new Player({
            name: 'P',
            game_id: game._id,
            user_id: new mongoose.Types.ObjectId(),
            position: { x: 0, y: 0 },
            health: 3,
            actions: 0
        }).save();

        await performActions(game);
        expect((await Game.findById(game._id)).turnTimePassed).toBe(1);
        expect((await Player.findById(player._id)).actions).toBe(2);
    });

    it('lists unplayed lobby matches alongside started ones', async () => {
        const creator = new mongoose.Types.ObjectId();
        const lobby = await new Game({
            name: 'debug-lobby',
            size: { width: 6, height: 6 },
            creator_id: creator,
            hasStarted: false
        }).save();

        const live = await new Game({
            name: 'debug-live',
            size: { width: 6, height: 6 },
            creator_id: creator,
            hasStarted: true,
            turnTime: 24,
            turnTimePassed: 1
        }).save();

        await new Player({
            name: 'LobbyHost',
            game_id: lobby._id,
            user_id: new mongoose.Types.ObjectId(),
            position: { x: 0, y: 0 },
            health: 3,
            actions: 0
        }).save();

        const games = await Game.find({});
        const enriched = await DebugController.enrichGamesForDebug(games);
        const byName = Object.fromEntries(enriched.map((g) => [g.name, g]));

        expect(byName['debug-lobby']).toBeTruthy();
        expect(byName['debug-lobby'].isUnplayed).toBe(true);
        expect(byName['debug-lobby'].hasStarted).toBe(false);
        expect(byName['debug-live'].isUnplayed).toBe(false);
        expect(byName['debug-live'].hasStarted).toBe(true);
        // Unplayed lobbies sort before live matches
        expect(enriched.findIndex((g) => g.name === 'debug-lobby'))
            .toBeLessThan(enriched.findIndex((g) => g.name === 'debug-live'));
    });

    it('deleteGame removes the match and its players', async () => {
        const game = await new Game({
            name: 'debug-delete-me',
            size: { width: 6, height: 6 },
            creator_id: new mongoose.Types.ObjectId(),
            hasStarted: false
        }).save();

        await new Player({
            name: 'Gone',
            game_id: game._id,
            user_id: new mongoose.Types.ObjectId(),
            position: { x: 0, y: 0 },
            health: 3,
            actions: 0
        }).save();

        const req = { params: { gameId: game._id.toString() }, body: {} };
        const res = mockRes();
        await DebugController.deleteGame(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(await Game.findById(game._id)).toBeNull();
        expect(await Player.find({ game_id: game._id })).toHaveLength(0);
    });

    it('deleteGame returns 404 for missing match', async () => {
        const req = { params: { gameId: new mongoose.Types.ObjectId().toString() }, body: {} };
        const res = mockRes();
        await DebugController.deleteGame(req, res);
        expect(res.statusCode).toBe(404);
        expect(res.body.ok).toBe(false);
    });
});
