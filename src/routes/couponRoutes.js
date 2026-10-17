const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Public validation endpoint for customers / friends in Cart
router.post('/validate', couponController.validateCoupon);

// Admin-protected endpoints
router.get('/', authenticateToken, requireAdmin, couponController.getAllCoupons);
router.post('/', authenticateToken, requireAdmin, couponController.createCoupon);
router.put('/:id', authenticateToken, requireAdmin, couponController.updateCoupon);
router.delete('/:id', authenticateToken, requireAdmin, couponController.deleteCoupon);

module.exports = router;
