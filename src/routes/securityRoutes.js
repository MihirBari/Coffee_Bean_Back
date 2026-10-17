const express = require('express');
const router = express.Router();
const securityController = require('../controllers/securityController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Admin-only security telemetry and anti-bot log inspection
router.get('/dashboard', authenticateToken, requireAdmin, securityController.getSecurityDashboard);

module.exports = router;
