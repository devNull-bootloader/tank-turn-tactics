const router = require('express').Router();
const { register, logout, guestLogin } = require('../controllers/AuthController.js')
const passport = require('passport');

router.post('/register', register)

router.post('/login', passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login?error=true'
}))

router.post('/guest', guestLogin)

router.get('/logout', logout)

module.exports = router;
