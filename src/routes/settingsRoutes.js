const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Public: get current store delivery rules and return policy
router.get('/', settingsController.getSettings);

// Admin: update delivery charges and return policy settings
router.put('/', authenticateToken, requireAdmin, settingsController.updateSettings);

module.exports = router;
