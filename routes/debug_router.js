const router = require('express').Router();
const { isDebug } = require('../middlewares/auth_middleware.js');
const DebugController = require('../controllers/DebugController.js');

router.use(isDebug);

router.get('/', DebugController.renderDebugPanel);

router.post('/games/:gameId/tick', DebugController.tickGame);
router.post('/games/:gameId/force-round', DebugController.forceRound);
router.post('/games/:gameId/resolve-queue', DebugController.resolveQueue);
router.post('/games/:gameId/clear-queue', DebugController.clearQueue);
router.post('/games/:gameId/grant-ap', DebugController.grantAp);
router.post('/games/:gameId/turn', DebugController.setTurnProgress);
router.post('/games/:gameId/settings', DebugController.updateSettings);
router.post('/games/:gameId/delete', DebugController.deleteGame);
router.delete('/games/:gameId', DebugController.deleteGame);
router.post('/players/:playerId', DebugController.updatePlayer);

module.exports = router;
