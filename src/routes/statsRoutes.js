const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

router.get('/dashboard', authenticateToken, requireAdmin, statsController.getDashboardStats);

module.exports = router;
