const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const { 
  honeypotCheck, 
  velocityCheck, 
  authRateLimiter, 
  otpRateLimiter 
} = require('../middleware/botProtection');

// Email verification OTP endpoints (with rate limiting & honeypot defense)
router.post('/send-otp', otpRateLimiter, honeypotCheck(), authController.sendVerificationCode);
router.post('/verify-otp', authController.verifyCode);
router.get('/check-verification', authController.checkEmailVerification);

// Authentication endpoints (protected against brute force bots & honeypot traps)
router.post('/register', authRateLimiter, honeypotCheck(), velocityCheck(1000), authController.register);
router.post('/login', authRateLimiter, honeypotCheck(), authController.login);
router.post('/admin-login', authRateLimiter, honeypotCheck(), authController.adminLogin);
router.get('/me', authenticateToken, authController.getMe);

// Wishlist endpoints
router.get('/wishlist', authenticateToken, authController.getWishlist);
router.post('/wishlist', authenticateToken, authController.addToWishlist);
router.delete('/wishlist/:product_id', authenticateToken, authController.removeFromWishlist);

module.exports = router;
