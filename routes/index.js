const router = require('express').Router()
const { isLoggedIn, isAdmin } = require('../middlewares/auth_middleware.js')
const Game = require('../models/GameModel.js')
const Player = require('../models/PlayerModel.js')
const { getUserGames, getGame } = require("../controllers/GameController.js");
const { displayName } = require("../controllers/AuthController.js");

function userId(user) {
    return user && (user.id || (user._id && user._id.toString ? user._id.toString() : user._id));
}

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Pages
router.get('/', asyncHandler(async (req, res) => {
    if (req.isAuthenticated()) {
        const games = await getUserGames(userId(req.user))
        res.render('pages/index', { user: displayName(req.user), games: games })
    } else {
        res.redirect('/login')
    }
}))

router.get('/register', (req, res) => {
    res.render('pages/register')
})

router.get('/login', (req, res) => {
    if (req.isAuthenticated()) {
        return res.redirect('/')
    }
    res.render('pages/login', { message: req.message ? res.message : '' })
})

// Join/create
router.get('/create-game', isLoggedIn, (req, res) => {
    res.render('pages/game/create', { name: displayName(req.user) } )
})

router.get('/join/:gameId?', isLoggedIn, (req, res, next) => {
    const { gameId } = req.params;

    res.render('pages/game/join', {
        gameName: "",
        name: displayName(req.user),
        usePassphrase: "",
        game_id: gameId ?? ''
    })
})

// Play
router.get('/play', isLoggedIn, asyncHandler(async (req, res) => {
    const gameId = req.query.game
    const uid = userId(req.user)

    const game = await getGame(gameId, uid)

    if (game.hasStarted) {
        res.render('pages/game/game', { game: game })
    } else if (!game.players.find(player => String(player.user_id) === String(uid))) {
        res.status(404).send('Whoops, not found!')
    } else {
        res.render('pages/game/lobby', {
            isCreator: String(game.creator_id) === String(uid),
            game: game
        })
    }
}))

// Footer

router.get('/how-to-play', (req, res) => {
    res.render("pages/how-to-play")
})

router.get('/credits', (req, res) => {
    res.render("pages/credits")
})

router.get('/changelog', (req, res) => {
    res.render("pages/changelog")
})

// Admin
router.get('/admin', isAdmin, async (req, res) => {
    res.render("pages/admin/admin-table")
})

module.exports = (app) => {
    app.use('/', router)
    app.use('/auth', require('./auth_router.js'))
    app.use('/user', require('./user_router.js'))
    app.use('/game', require('./game_router.js'))
    app.use('/action', require('./action_router.js'))
}
