const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');

// Comprehensive list of disposable / temporary / burner email domains
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com',
  '10minutemail.com',
  '10minutemail.net',
  'tempmail.com',
  'temp-mail.org',
  'guerrillamail.com',
  'guerrillamailblock.com',
  'sharklasers.com',
  'grr.la',
  'trashmail.com',
  'trashmail.net',
  'yopmail.com',
  'yopmail.net',
  'dispostable.com',
  'getairmail.com',
  'throwawaymail.com',
  'fakemailgenerator.com',
  'mohmal.com',
  'nada.ltd',
  'crazymailing.com',
  'generator.email',
  'emailondeck.com',
  'inboxbear.com',
  'burnermail.io',
  'dropmail.me',
  'tempail.com',
  'pokemail.net',
  'spam4.me',
  'maildrop.cc',
  'mytemp.email',
  'mytempemail.com',
  'fakeinbox.com',
  'harakirimail.com',
  'throwaway.email',
  'zillamail.com',
  'trashymail.com',
  'mailforspam.com',
  'disposablemail.com',
  'tempinbox.com',
  'generator-mail.com',
  'getnada.com',
  'abcvg.com',
  'bccto.me',
  'chacuo.net',
  'crazymailing.com',
  'drdrb.net',
  'emailfake.com',
  'fakemail.net',
  'guerrillamail.biz',
  'guerrillamail.de',
  'guerrillamail.net',
  'guerrillamail.org',
  'incognitomail.org',
  'mailcatch.com',
  'mailnesia.com',
  'mailsac.com',
  'maildrop.cc',
  'mintemail.com',
  'mytemp.email',
  'noclickemail.com',
  'owlymail.com',
  'spambog.com',
  'spamgourmet.com',
  'trashmail.me',
  'wegwerfmail.de',
  'wegwerfmail.net',
  'zehnminutenmail.de'
]);

/**
 * Asynchronously record security telemetry in MariaDB
 */
async function logSecurityEvent(eventType, severity = 'INFO', ipAddress = '', email = '', details = '') {
  try {
    await pool.query(
      `INSERT INTO security_audit_logs (event_type, severity, ip_address, email, details)
       VALUES (?, ?, ?, ?, ?)`,
      [eventType, severity, ipAddress || 'unknown', email || 'anonymous', details]
    );
  } catch (err) {
    console.error('Failed to log security event:', err.message);
  }
}

/**
 * Check if an email uses a disposable / temporary domain
 */
function isDisposableEmail(email) {
  if (!email || typeof email !== 'string') return true;
  const parts = email.trim().toLowerCase().split('@');
  if (parts.length !== 2) return true;
  const domain = parts[1].trim();

  // Check exact domain and subdomains
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    return true;
  }

  // Also check if domain ends with any disposable domain
  for (const disp of DISPOSABLE_EMAIL_DOMAINS) {
    if (domain.endsWith('.' + disp)) {
      return true;
    }
  }

  return false;
}

/**
 * RFC email syntax validation
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return re.test(email.trim());
}

/**
 * Honeypot middleware: Detects automated bots that blindly fill all HTML form inputs
 */
function honeypotCheck(honeypotFields = ['hp_website', 'bot_trap', 'company_fax']) {
  return async (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || '';
    const body = req.body || {};

    for (const field of honeypotFields) {
      if (body[field] && String(body[field]).trim().length > 0) {
        const detectedVal = String(body[field]);
        console.warn(`🚨 [BOT BLOCKED] Honeypot trap "${field}" triggered from IP: ${ip}. Value: "${detectedVal}"`);
        
        await logSecurityEvent(
          'BOT_HONEYPOT_TRIGGERED',
          'BLOCKED_ATTACK',
          ip,
          body.email || body.customer_email || '',
          `Automated script filled invisible field "${field}". Value: "${detectedVal.substring(0, 50)}"`
        );

        // Add 1.2s tarpit delay to waste malicious bot CPU cycles
        await new Promise((resolve) => setTimeout(resolve, 1200));

        return res.status(400).json({
          success: false,
          error_code: 'BOT_HONEYPOT_DETECTED',
          message: 'Automated submission blocked by Roastery Bot Shield. If you are human, please refresh and try again.'
        });
      }
    }
    next();
  };
}

/**
 * Submission velocity check: Blocks instant form submissions (< 1.2s)
 */
function velocityCheck(minDurationMs = 1200) {
  return async (req, res, next) => {
    const clientLoadedAt = parseInt(req.body.client_loaded_at, 10);
    const ip = req.ip || req.connection.remoteAddress || '';

    // If client provided a load timestamp, check elapsed time
    if (clientLoadedAt && !isNaN(clientLoadedAt)) {
      const elapsed = Date.now() - clientLoadedAt;
      if (elapsed > 0 && elapsed < minDurationMs) {
        console.warn(`🚨 [BOT BLOCKED] Super-human submission speed (${elapsed}ms < ${minDurationMs}ms) from IP ${ip}`);
        
        await logSecurityEvent(
          'BOT_VELOCITY_TRIGGERED',
          'BLOCKED_ATTACK',
          ip,
          req.body.email || req.body.customer_email || '',
          `Form submitted in ${elapsed}ms, faster than human threshold (${minDurationMs}ms).`
        );

        return res.status(400).json({
          success: false,
          error_code: 'BOT_VELOCITY_DETECTED',
          message: 'Submission too fast. Please take your time to review details before ordering.'
        });
      }
    }
    next();
  };
}

/**
 * Disposable email blocker middleware
 */
function enforceGenuineEmail(field = 'email') {
  return async (req, res, next) => {
    const email = req.body[field] || req.body.customer_email || req.body.email;
    const ip = req.ip || req.connection.remoteAddress || '';

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid, well-formed email address.'
      });
    }

    if (isDisposableEmail(email)) {
      await logSecurityEvent(
        'DISPOSABLE_EMAIL_BLOCKED',
        'BLOCKED_ATTACK',
        ip,
        email,
        'Order or registration attempted with disposable burner email domain.'
      );

      return res.status(400).json({
        success: false,
        error_code: 'DISPOSABLE_EMAIL_REJECTED',
        message: 'Temporary or disposable email addresses are not accepted to protect against fraudulent orders. Please use a genuine email address (e.g. Gmail, Outlook, Yahoo, or your company domain).'
      });
    }

    next();
  };
}

// Global API Rate Limiter: 150 requests per minute per IP
const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error_code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests from this network. Roastery security rate limit engaged. Please wait a minute.'
  }
});

// Sensitive Order Rate Limiter: max 6 orders per 10 minutes per IP
const orderRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error_code: 'ORDER_RATE_LIMIT_EXCEEDED',
    message: 'Too many orders placed in a short window. Please wait a few minutes before submitting another order.'
  }
});

// OTP Request Rate Limiter: max 4 verification requests per 5 minutes per IP
const otpRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 4,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error_code: 'OTP_RATE_LIMIT_EXCEEDED',
    message: 'Too many verification code requests. Please wait 5 minutes before requesting again to prevent spam.'
  }
});

// Auth (Login / Register) Rate Limiter: max 12 attempts per 15 minutes per IP
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error_code: 'AUTH_RATE_LIMIT_EXCEEDED',
    message: 'Too many authentication attempts. Please wait 15 minutes or contact support.'
  }
});

module.exports = {
  isDisposableEmail,
  isValidEmail,
  logSecurityEvent,
  honeypotCheck,
  velocityCheck,
  enforceGenuineEmail,
  globalApiLimiter,
  orderRateLimiter,
  otpRateLimiter,
  authRateLimiter
};
