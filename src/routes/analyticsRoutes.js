const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Public tracking endpoints for web visitor events
router.post('/track-view', analyticsController.trackPageView);
router.post('/track-product', analyticsController.trackProductEvent);

// Admin-only dashboard analytics & stock intelligence
router.get('/dashboard', authenticateToken, requireAdmin, analyticsController.getAnalyticsDashboard);

module.exports = router;
