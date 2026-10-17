const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticateToken, authenticateOptional, requireAdmin } = require('../middleware/auth');
const {
  honeypotCheck,
  velocityCheck,
  enforceGenuineEmail,
  orderRateLimiter
} = require('../middleware/botProtection');

// Customer placing order: protected against bot attacks, rapid-fire draining, and fake emails
router.post(
  '/',
  orderRateLimiter,
  honeypotCheck(),
  velocityCheck(1200),
  enforceGenuineEmail('customer_email'),
  authenticateOptional,
  orderController.createOrder
);

// Admin-only order inspection and status updates
router.get('/', authenticateToken, requireAdmin, orderController.getOrders);
router.get('/:id', authenticateToken, orderController.getOrderById);
router.get('/:id/notifications', authenticateToken, orderController.getOrderNotifications);
router.patch('/:id/status', authenticateToken, requireAdmin, orderController.updateOrderStatus);

module.exports = router;
