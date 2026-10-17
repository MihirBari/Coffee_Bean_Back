const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Gateway Config (Public Key, active status)
router.get('/config', paymentController.getPaymentConfig);

// Create Razorpay Order
router.post('/razorpay/create-order', paymentController.createRazorpayOrder);

// Verify Razorpay Payment Signature
router.post('/razorpay/verify', paymentController.verifyRazorpayPayment);

module.exports = router;
