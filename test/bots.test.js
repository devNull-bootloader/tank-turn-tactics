const DBHandler = require('./db_handler');
const mongoose = require('mongoose');
const Game = require('../models/GameModel.js');
const Player = require('../models/PlayerModel.js');
const { createGuestUser, createBotUser } = require('../controllers/AuthController.js');
const { createVsBotsGame, runBotsForGame, resolvePace } = require('../controllers/BotController.js');
const { performActions, QUICK_TICK_MS } = require('../config/game_runner.js');

DBHandler.setup();

describe('Bots mode', () => {
    it('creates bot users marked as bots', async () => {
        const bot = await createBotUser();
        expect(bot.bot).toBe(true);
        expect(!!bot.admin).toBe(false);
        expect(String(bot.username)).toMatch(/^bot_/);
    });

    it('defaults to quick pace (more AP, quickMatch flag)', () => {
        const pace = resolvePace('quick');
        expect(pace.quickMatch).toBe(true);
        expect(pace.actionsPerInterval).toBeGreaterThanOrEqual(2);
        expect(QUICK_TICK_MS).toBeGreaterThan(0);
        expect(QUICK_TICK_MS).toBeLessThanOrEqual(60000);
    });

    it('starts a vs-bots match with human + bot players on the board', async () => {
        const human = await createGuestUser();
        const game = await createVsBotsGame(human, { botCount: 2, size: 8 });

        expect(game.vsBots).toBe(true);
        expect(game.hasStarted).toBe(true);
        expect(game.quickMatch).toBe(true);
        expect(game.turnTime).toBe(1);
        expect(game.actionsPerInterval).toBe(3);

        const players = await Player.find({ game_id: game._id });
        expect(players).toHaveLength(3);
        expect(players.filter(p => p.isBot)).toHaveLength(2);
        expect(players.every(p => p.position && p.position.x != null)).toBe(true);
        const person = players.find(p => !p.isBot);
        expect(person.actions).toBe(3);
    });

    it('supports classic pace without quickMatch', async () => {
        const human = await createGuestUser();
        const game = await createVsBotsGame(human, { botCount: 1, size: 6, pace: 'classic' });
        expect(game.quickMatch).toBe(false);
        expect(game.isTutorial).toBe(false);
        expect(game.actionsPerInterval).toBe(1);
        const players = await Player.find({ game_id: game._id });
        const person = players.find(p => !p.isBot);
        // Opening bot think may spend bot AP; the human keeps the classic starting allotment
        expect(person.actions).toBe(1);
    });

    it('starts a tutorial match with guided flags and small board', async () => {
        const human = await createGuestUser();
        const game = await createVsBotsGame(human, {
            botCount: 2,
            size: 6,
            pace: 'quick',
            isTutorial: true
        });
        expect(game.isTutorial).toBe(true);
        expect(game.quickMatch).toBe(true);
        expect(game.vsBots).toBe(true);
        expect(game.size.width).toBe(6);
        expect(String(game.name)).toMatch(/Tutorial/i);
    });

    it('bots spend AP through real action controllers', async () => {
        const human = await createGuestUser();
        const game = await createVsBotsGame(human, { botCount: 1, size: 6 });
        const players = await Player.find({ game_id: game._id });
        const bot = players.find(p => p.isBot);
        const person = players.find(p => !p.isBot);
        expect(bot).toBeTruthy();
        expect(person).toBeTruthy();

        // Place bot orthogonally adjacent and grant AP so a move/attack is possible
        bot.position = { x: person.position.x, y: person.position.y + 1 };
        if (bot.position.y >= game.size.height) {
            bot.position.y = person.position.y - 1;
        }
        bot.actions = 2;
        await bot.save();

        const beforeActions = bot.actions;
        const beforeX = bot.position.x;
        const beforeY = bot.position.y;
        await runBotsForGame(game._id);
        const after = await Player.findById(bot._id);

        const moved = after.position.x !== beforeX || after.position.y !== beforeY;
        const spent = after.actions < beforeActions;
        const damagedHuman = (await Player.findById(person._id)).health < person.health;
        expect(moved || spent || damagedHuman).toBe(true);
    });

    it('game_runner bot hook does not throw for vsBots games', async () => {
        const human = await createGuestUser();
        const game = await createVsBotsGame(human, { botCount: 1, size: 6 });
        game.turnTimePassed = game.turnTime;
        await game.save();
        await expect(performActions(game)).resolves.not.toThrow();
    });

    it('quick match tick grants AP when turnTime elapsed', async () => {
        const human = await createGuestUser();
        const game = await createVsBotsGame(human, { botCount: 1, size: 6, pace: 'quick' });
        const players = await Player.find({ game_id: game._id });
        for (const p of players) {
            p.actions = 0;
            await p.save();
        }
        game.turnTimePassed = game.turnTime;
        await game.save();
        await performActions(game);
        // Bots may spend freshly granted AP in the post-tick think; the human should keep it
        const person = (await Player.find({ game_id: game._id })).find(p => !p.isBot);
        expect(person.actions).toBeGreaterThanOrEqual(game.actionsPerInterval);
    });
});
