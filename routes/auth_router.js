const router = require('express').Router();
const { register, logout, guestLogin, debugLogin } = require('../controllers/AuthController.js')
const { botsLoginAndPlay, tutorialLoginAndPlay } = require('../controllers/BotController.js')
const passport = require('passport');

router.post('/register', register)

router.post('/login', passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login?error=true'
}))

router.post('/guest', guestLogin)

router.post('/bots', botsLoginAndPlay)

router.post('/tutorial', tutorialLoginAndPlay)

router.post('/debug', debugLogin)

router.get('/logout', logout)

module.exports = router;
