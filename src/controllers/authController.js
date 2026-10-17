const { pool } = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendVerificationOTP, verifyOTP, verifyProofToken } = require('../services/emailService');
const { isDisposableEmail, isValidEmail, logSecurityEvent } = require('../middleware/botProtection');

const JWT_SECRET = process.env.JWT_SECRET || 'coffee_bean_artisan_secret_key_2026';

// Send Email Verification OTP
exports.sendVerificationCode = async (req, res) => {
  try {
    const { email, purpose } = req.body;
    const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Invalid email address format' });
    }

    if (isDisposableEmail(normalizedEmail)) {
      await logSecurityEvent('DISPOSABLE_EMAIL_BLOCKED', 'BLOCKED_ATTACK', clientIp, normalizedEmail, 'OTP request blocked: disposable email.');
      return res.status(400).json({
        success: false,
        error_code: 'DISPOSABLE_EMAIL_REJECTED',
        message: 'Temporary or disposable email addresses are not accepted to prevent fraudulent orders. Please use a genuine email.'
      });
    }

    const result = await sendVerificationOTP(normalizedEmail, purpose || 'order_checkout', clientIp);
    await logSecurityEvent('OTP_DISPATCHED', 'INFO', clientIp, normalizedEmail, `Verification code dispatched for purpose "${purpose || 'order_checkout'}"`);

    res.json({
      success: true,
      message: `A 6-digit verification code has been dispatched to ${normalizedEmail}.`,
      expiresInSeconds: result.expiresInSeconds,
      dev_otp: result.dev_otp // provided in non-production for instant friction-free testing
    });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({ success: false, message: 'Failed to dispatch verification code', error: error.message });
  }
};

// Verify OTP Code and issue verification token
exports.verifyCode = async (req, res) => {
  try {
    const { email, otp, purpose } = req.body;
    const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and 6-digit verification code are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const result = await verifyOTP(normalizedEmail, otp, purpose || 'order_checkout');

    if (!result.success) {
      await logSecurityEvent('OTP_VERIFICATION_FAILED', 'WARNING', clientIp, normalizedEmail, result.message);
      return res.status(400).json({ success: false, message: result.message });
    }

    await logSecurityEvent('EMAIL_VERIFIED_SUCCESS', 'INFO', clientIp, normalizedEmail, 'Email verified successfully via 6-digit code.');

    res.json({
      success: true,
      message: 'Email address verified successfully!',
      verification_token: result.verification_token,
      email: normalizedEmail
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ success: false, message: 'Failed to verify code', error: error.message });
  }
};

// Register customer
exports.register = async (req, res) => {
  try {
    const { name, email, password, verification_token } = req.body;
    const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    }

    if (isDisposableEmail(normalizedEmail)) {
      await logSecurityEvent('DISPOSABLE_EMAIL_BLOCKED', 'BLOCKED_ATTACK', clientIp, normalizedEmail, 'Registration blocked: disposable email.');
      return res.status(400).json({
        success: false,
        error_code: 'DISPOSABLE_EMAIL_REJECTED',
        message: 'Temporary or disposable email domains are blocked to prevent bot spam. Please use a genuine email provider.'
      });
    }

    // Check if email already registered
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists' });
    }

    // Check if verification token was provided
    let isEmailVerified = 0;
    if (verification_token && verifyProofToken(verification_token, normalizedEmail)) {
      isEmailVerified = 1;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password, role, is_email_verified) VALUES (?, ?, ?, "customer", ?)',
      [name, normalizedEmail, hashedPassword, isEmailVerified]
    );

    const user = { id: result.insertId, name, email: normalizedEmail, role: 'customer', is_email_verified: isEmailVerified };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });

    await logSecurityEvent('CUSTOMER_REGISTERED', 'INFO', clientIp, normalizedEmail, `Account created. Email verified: ${isEmailVerified}`);

    res.status(201).json({
      success: true,
      message: 'Account created successfully! Welcome to Coffee Bean.',
      token,
      user
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration', error: error.message });
  }
};

// Customer & General Login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const tokenPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      is_email_verified: user.is_email_verified ? 1 : 0
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      message: 'Logged in successfully',
      token,
      user: tokenPayload
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login', error: error.message });
  }
};

// Admin Specific Login (recheck role == 'admin')
exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized. This account does not possess Administrator privileges.'
      });
    }

    const tokenPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: 'admin',
      is_email_verified: 1
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      message: 'Roastery Administrator authenticated successfully',
      token,
      user: tokenPayload
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ success: false, message: 'Server error during admin login', error: error.message });
  }
};

// Get current logged-in user profile
exports.getMe = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, email, role, is_email_verified, created_at FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Get user wishlist
exports.getWishlist = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.*, w.created_at as added_to_wishlist_at 
      FROM wishlists w 
      JOIN products p ON w.product_id = p.id 
      WHERE w.user_id = ?
      ORDER BY w.id DESC
    `, [req.user.id]);

    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error retrieving wishlist', error: error.message });
  }
};

// Add product to wishlist
exports.addToWishlist = async (req, res) => {
  try {
    const { product_id } = req.body;
    if (!product_id) {
      return res.status(400).json({ success: false, message: 'product_id is required' });
    }

    await pool.query(
      'INSERT IGNORE INTO wishlists (user_id, product_id) VALUES (?, ?)',
      [req.user.id, product_id]
    );

    res.json({ success: true, message: 'Product added to wishlist' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error updating wishlist', error: error.message });
  }
};

// Remove from wishlist
exports.removeFromWishlist = async (req, res) => {
  try {
    const { product_id } = req.params;
    await pool.query('DELETE FROM wishlists WHERE user_id = ? AND product_id = ?', [req.user.id, product_id]);
    res.json({ success: true, message: 'Product removed from wishlist' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error updating wishlist', error: error.message });
  }
};

// Check if an email is already verified (in users table or past verifications)
exports.checkEmailVerification = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ success: false, is_verified: false, message: 'Email required' });
    }
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Check users table
    const [uRows] = await pool.query('SELECT is_email_verified FROM users WHERE email = ?', [normalizedEmail]);
    if (uRows.length > 0 && uRows[0].is_email_verified === 1) {
      return res.json({ success: true, is_verified: true, source: 'registered_user' });
    }

    // 2. Check email_verifications table for prior successful verification
    const [vRows] = await pool.query('SELECT id FROM email_verifications WHERE email = ? AND is_used = 1 LIMIT 1', [normalizedEmail]);
    if (vRows.length > 0) {
      return res.json({ success: true, is_verified: true, source: 'prior_otp' });
    }

    return res.json({ success: true, is_verified: false });
  } catch (error) {
    console.error('Error checking verification:', error);
    res.status(500).json({ success: false, is_verified: false, error: error.message });
  }
};

