const router = require('express').Router();
const { createGameRequest, joinGameRequest, getGameRequest, startGameRequest, getUserGamesRequest, getPlayerRequest, getPlayers, deleteGameRequest, getAllGamesRequest,
    renamePlayerRequest,editGameRequest
} = require('../controllers/GameController.js')
const { isAdmin, isLoggedIn, isGameCreatorOrAdmin } = require("../middlewares/auth_middleware.js");

// Admin

router.delete('/:gameId', isAdmin, deleteGameRequest)

router.get('/all', isAdmin, getAllGamesRequest)

router.put('/:gameId', isAdmin, editGameRequest)

// User

router.post('/', isLoggedIn, createGameRequest);

router.get('/user', isLoggedIn, getUserGamesRequest)

router.get('/:gameId/player', isLoggedIn, getPlayerRequest)

router.get('/:gameId/players', isLoggedIn, getPlayers)

router.get('/:gameId', isLoggedIn, getGameRequest);

router.post('/player', isLoggedIn, joinGameRequest);

router.patch('/:gameId/start', isLoggedIn, isGameCreatorOrAdmin, startGameRequest);

router.patch('/:gameId/rename/:name', isLoggedIn, renamePlayerRequest)



module.exports = router;
