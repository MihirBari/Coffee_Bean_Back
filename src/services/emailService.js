const nodemailer = require('nodemailer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'coffee_bean_artisan_secret_key_2026';

// Reusable Transporter (if configured in environment)
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const user = process.env.SMTP_USER.trim();
    const pass = process.env.SMTP_PASS.replace(/\s+/g, '');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST.trim(),
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
    });
    console.log(`📧 SMTP Live Mail Transport configured successfully for [${user}].`);
  } else {
    console.log('📬 Simulated Roastery Mailer active (OTPs logged to server console & dev UI). Configure SMTP_* in .env to send real emails.');
  }
  return transporter;
}
getTransporter();

/**
 * Generate cryptographically secure 6-digit numeric OTP
 */
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Send Email OTP verification code
 * @param {string} email - Target recipient
 * @param {string} purpose - 'order_checkout' | 'registration' | 'login_verify' | 'cod_confirm'
 * @param {string} ipAddress - Client IP
 */
async function sendVerificationOTP(email, purpose = 'order_checkout', ipAddress = '') {
  const normalizedEmail = email.trim().toLowerCase();
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

  // Invalidate any prior active OTPs for this email and purpose
  await pool.query(
    'UPDATE email_verifications SET is_used = 1 WHERE email = ? AND purpose = ? AND is_used = 0',
    [normalizedEmail, purpose]
  );

  // Insert new OTP record
  await pool.query(
    `INSERT INTO email_verifications (email, otp_code, purpose, expires_at, attempts_left, is_used, ip_address)
     VALUES (?, ?, ?, ?, 5, 0, ?)`,
    [normalizedEmail, otp, purpose, expiresAt, ipAddress]
  );

  const subject = purpose === 'order_checkout'
    ? `☕ [${otp}] Verify your Coffee Bean Order Email`
    : `☕ [${otp}] Verify your Coffee Bean Account`;

  const htmlContent = `
    <div style="max-width: 540px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #231815; color: #F5EFC6; border-radius: 16px; overflow: hidden; border: 1px solid #4A2E27;">
      <div style="background-color: #4D0E12; padding: 24px 20px; text-align: center; border-bottom: 2px solid rgba(245, 239, 198, 0.2);">
        <h1 style="margin: 0; font-size: 20px; letter-spacing: 2px; text-transform: uppercase; color: #F5EFC6;">COFFEE BEAN</h1>
        <p style="margin: 4px 0 0; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #A5BCD6;">ARTISANAL ROASTERY • SECURITY SHIELD</p>
      </div>
      <div style="padding: 30px 24px; text-align: center;">
        <h2 style="margin: 0 0 12px; font-size: 22px; color: #F5EFC6;">Email Verification Code</h2>
        <p style="margin: 0 0 24px; font-size: 13px; line-height: 1.6; color: rgba(245, 239, 198, 0.85);">
          Please enter the following 6-digit one-time code to confirm your email address and authorize your request. This helps protect against fake orders and unauthorized checkout.
        </p>
        
        <div style="background-color: #18100E; border: 2px dashed #A5BCD6; border-radius: 12px; padding: 18px 24px; display: inline-block; margin-bottom: 24px;">
          <span style="font-family: monospace, Courier; font-size: 34px; font-weight: 900; letter-spacing: 8px; color: #F5EFC6;">
            ${otp}
          </span>
        </div>

        <p style="margin: 0 0 8px; font-size: 11px; color: #A5BCD6;">
          ⏱️ This code expires in <strong>10 minutes</strong>. Never share this code with anyone.
        </p>
        <p style="margin: 0; font-size: 11px; color: rgba(245, 239, 198, 0.5);">
          If you did not request this email, please disregard it. No order will be processed without verification.
        </p>
      </div>
      <div style="background-color: #18100E; padding: 14px 20px; text-align: center; font-size: 10px; color: rgba(245, 239, 198, 0.4); border-top: 1px solid #4A2E27;">
        © 2026 Coffee Bean Artisanal Roastery • Bengaluru, India • All rights reserved.
      </div>
    </div>
  `;

  // Always log clearly to server console
  console.log(`\n========================================================`);
  console.log(`🔐 [ROASTERY SECURITY SHIELD] EMAIL VERIFICATION OTP`);
  console.log(`✉️ Target Email:   ${normalizedEmail}`);
  console.log(`🔑 Verification Code: [ ${otp} ]`);
  console.log(`🎯 Purpose:        ${purpose}`);
  console.log(`⏱️ Expiry:         10 Minutes (${expiresAt.toISOString()})`);
  console.log(`========================================================\n`);

  // Attempt live email send if transporter configured
  const mailer = getTransporter();
  if (mailer) {
    try {
      const fromAddress = process.env.SMTP_FROM || `"The Bean Co. Roastery" <${process.env.SMTP_USER.trim()}>`;
      await mailer.sendMail({
        from: fromAddress,
        to: normalizedEmail,
        subject,
        html: htmlContent,
      });
      console.log(`✅ Live verification email delivered to ${normalizedEmail}`);
    } catch (mailErr) {
      console.error(`⚠️ Failed to deliver live SMTP email to ${normalizedEmail}:`, mailErr.message);
      // Still allow flow since OTP is saved in database
    }
  }

  return {
    success: true,
    email: normalizedEmail,
    expiresInSeconds: 600,
    // Return dev_otp in non-production environments to allow instant friction-free dev testing
    dev_otp: process.env.NODE_ENV === 'production' ? undefined : otp
  };
}

/**
 * Verify OTP Code
 * @param {string} email 
 * @param {string} otp 
 * @param {string} purpose 
 */
async function verifyOTP(email, otp, purpose = 'order_checkout') {
  const normalizedEmail = email.trim().toLowerCase();
  const cleanOtp = String(otp || '').trim();

  const [records] = await pool.query(
    `SELECT * FROM email_verifications 
     WHERE email = ? AND purpose = ? AND is_used = 0 
     ORDER BY id DESC LIMIT 1`,
    [normalizedEmail, purpose]
  );

  if (records.length === 0) {
    return {
      success: false,
      message: 'No active verification code found for this email. Please request a new code.'
    };
  }

  const record = records[0];

  // Check expiration
  const now = new Date();
  const expiresAt = new Date(record.expires_at);
  if (now > expiresAt) {
    await pool.query('UPDATE email_verifications SET is_used = 1 WHERE id = ?', [record.id]);
    return {
      success: false,
      message: 'Verification code has expired (10 min limit). Please request a fresh code.'
    };
  }

  // Check attempts remaining
  if (record.attempts_left <= 0) {
    await pool.query('UPDATE email_verifications SET is_used = 1 WHERE id = ?', [record.id]);
    return {
      success: false,
      message: 'Too many incorrect attempts. This code has been invalidated for security. Please request a new code.'
    };
  }

  // Compare OTP
  if (record.otp_code !== cleanOtp) {
    await pool.query('UPDATE email_verifications SET attempts_left = attempts_left - 1 WHERE id = ?', [record.id]);
    const remaining = record.attempts_left - 1;
    return {
      success: false,
      message: `Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
    };
  }

  // Mark as used
  await pool.query('UPDATE email_verifications SET is_used = 1 WHERE id = ?', [record.id]);

  // Update user table if registered
  await pool.query(
    'UPDATE users SET is_email_verified = 1, email_verified_at = CURRENT_TIMESTAMP WHERE email = ?',
    [normalizedEmail]
  );

  // Generate signed verification proof token (valid for 30 minutes)
  const verificationProofToken = jwt.sign(
    {
      email: normalizedEmail,
      purpose,
      verifiedAt: Date.now(),
      is_verified: true
    },
    JWT_SECRET,
    { expiresIn: '30m' }
  );

  return {
    success: true,
    message: 'Email address verified successfully!',
    email: normalizedEmail,
    verification_token: verificationProofToken
  };
}

/**
 * Verify verification proof token
 * @param {string} token 
 * @param {string} expectedEmail 
 */
function verifyProofToken(token, expectedEmail) {
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || !decoded.is_verified) return false;
    if (expectedEmail && decoded.email.toLowerCase() !== expectedEmail.trim().toLowerCase()) {
      return false;
    }
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Send rich, branded transactional HTML email when order status updates
 * Events: 'PROCESSING' | 'SHIPPED' | 'DELIVERED'
 * @param {Object} options
 * @param {Object} options.order
 * @param {Array}  [options.items]
 * @param {string} options.event
 */
async function sendOrderStatusEmail({ order, items = [], event }) {
  if (!order || !order.customer_email) {
    return { success: false, message: 'Order with customer email is required' };
  }

  const normalizedEmail = order.customer_email.trim().toLowerCase();
  const customerName = order.customer_name || 'Valued Customer';
  const orderNumber = order.order_number || `ORD-${order.id}`;
  const totalAmount = parseFloat(order.total_amount || 0).toFixed(2);
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const courier = order.courier_name || 'Roastery Express Logistics';
  const trackingNumber = order.tracking_number || `ROAST-AWB-${order.id}9482`;
  const estDate = order.estimated_delivery
    ? new Date(order.estimated_delivery).toLocaleDateString('en-IN', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
    : '2 to 3 Business Days';

  const uppercaseEvent = (event || order.status || 'PROCESSING').toUpperCase();

  let subject = '';
  let badgeText = '';
  let badgeColor = '';
  let headline = '';
  let leadText = '';
  let extraContent = '';

  const itemsHtml = items.length > 0 ? items.map(item => `
    <tr>
      <td style="padding: 10px 12px; border-bottom: 1px solid rgba(74, 46, 39, 0.4); font-size: 13px; color: #F5EFC6;">
        <strong>${item.product_name}</strong>
        ${item.grind_type ? `<br><span style="font-size: 11px; color: #A5BCD6;">Grind: ${item.grind_type}</span>` : ''}
      </td>
      <td style="padding: 10px 12px; border-bottom: 1px solid rgba(74, 46, 39, 0.4); font-size: 13px; text-align: center; color: #A5BCD6;">
        ×${item.quantity}
      </td>
      <td style="padding: 10px 12px; border-bottom: 1px solid rgba(74, 46, 39, 0.4); font-size: 13px; text-align: right; color: #F5EFC6; font-weight: bold;">
        ₹${parseFloat(item.subtotal || item.unit_price * item.quantity).toFixed(2)}
      </td>
    </tr>
  `).join('') : `
    <tr>
      <td colspan="3" style="padding: 12px; font-size: 13px; color: #F5EFC6; text-align: center;">
        Artisanal Roastery Canisters
      </td>
    </tr>
  `;

  if (uppercaseEvent === 'PROCESSING' || uppercaseEvent === 'ORDER_PLACED') {
    subject = `☕ [Processing] Order #${orderNumber} is being handcrafted at the Roastery`;
    badgeText = 'ROASTERY PROCESSING & PACKAGING';
    badgeColor = '#9333ea';
    headline = 'Your Fresh Roast is Underway!';
    leadText = `Hello <strong>${customerName}</strong>, thank you for choosing Coffee Bean! Our roast masters have received your order and are freshly weighing, precision-grinding (if requested), and packaging your coffee into sealed nitrogen-flushed canisters to preserve maximum aroma.`;
    extraContent = `
      <div style="background-color: #18100E; border: 1px solid #4A2E27; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px; text-align: left;">
        <h4 style="margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; color: #A5BCD6;">Next Milestone</h4>
        <p style="margin: 0; font-size: 13px; color: #F5EFC6; line-height: 1.5;">
          Once the roast cycle and quality assurance check are complete, our dispatch team will assign express courier shipping and email + SMS you the live AWB tracking number.
        </p>
      </div>
    `;
  } else if (uppercaseEvent === 'SHIPPED') {
    subject = `🚚 [Shipped] Your Coffee Bean Order #${orderNumber} is on the way!`;
    badgeText = 'DISPATCHED • IN TRANSIT';
    badgeColor = '#3b82f6';
    headline = 'Your Coffee is on the Way!';
    leadText = `Great news, <strong>${customerName}</strong>! Your coffee canisters have completed quality inspection, departed our roastery, and are speeding toward your doorstep via express logistics.`;
    extraContent = `
      <div style="background: linear-gradient(135deg, #18100E 0%, #2A1713 100%); border: 2px solid #3b82f6; border-radius: 12px; padding: 20px; margin-bottom: 24px; text-align: left;">
        <h4 style="margin: 0 0 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #93c5fd; font-weight: 800;">
          LOGISTICS & TRACKING DETAILS
        </h4>
        <div style="display: table; width: 100%;">
          <div style="display: table-row;">
            <div style="display: table-cell; padding-bottom: 8px; font-size: 12px; color: #A5BCD6;">Carrier Partner:</div>
            <div style="display: table-cell; padding-bottom: 8px; font-size: 13px; color: #F5EFC6; font-weight: bold; text-align: right;">${courier}</div>
          </div>
          <div style="display: table-row;">
            <div style="display: table-cell; padding-bottom: 8px; font-size: 12px; color: #A5BCD6;">AWB Tracking:</div>
            <div style="display: table-cell; padding-bottom: 8px; font-size: 13px; color: #93c5fd; font-family: monospace; font-weight: bold; text-align: right;">${trackingNumber}</div>
          </div>
          <div style="display: table-row;">
            <div style="display: table-cell; font-size: 12px; color: #A5BCD6;">Estimated Arrival:</div>
            <div style="display: table-cell; font-size: 13px; color: #34d399; font-weight: bold; text-align: right;">${estDate}</div>
          </div>
        </div>
      </div>
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${clientUrl}" style="background-color: #4D0E12; color: #F5EFC6; padding: 12px 28px; border-radius: 10px; text-decoration: none; font-weight: bold; font-size: 13px; letter-spacing: 1px; display: inline-block; border: 1px solid rgba(245, 239, 198, 0.4); text-transform: uppercase;">
          Track Live Shipment →
        </a>
      </div>
    `;
  } else if (uppercaseEvent === 'DELIVERED') {
    subject = `✨ [Delivered] Order #${orderNumber} Delivered - Enjoy your specialty roast!`;
    badgeText = 'SAFELY DELIVERED ✓';
    badgeColor = '#10b981';
    headline = 'Delivered & Ready to Brew!';
    leadText = `Hello <strong>${customerName}</strong>! Our courier has marked order <strong>#${orderNumber}</strong> as delivered to your doorstep. We hope you enjoy the unforgettable aroma, velvety body, and sweet acidity of your freshly roasted coffee.`;
    extraContent = `
      <div style="background-color: #18100E; border: 1px solid #059669; border-radius: 12px; padding: 18px 20px; margin-bottom: 24px; text-align: left;">
        <h4 style="margin: 0 0 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #6ee7b7; font-weight: 800;">
          BARISTA FRESHNESS & BREWING TIPS
        </h4>
        <ul style="margin: 0; padding-left: 18px; font-size: 12px; color: #F5EFC6; line-height: 1.7;">
          <li><strong>Water Temperature:</strong> Brew between 92°C – 96°C for sweet, balanced extraction.</li>
          <li><strong>Resting Beans:</strong> Let freshly sealed beans rest for 2-3 minutes after unsealing to bloom.</li>
          <li><strong>Preserve Freshness:</strong> Always close the airtight lid tightly to prevent bean oxidation.</li>
        </ul>
      </div>
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${clientUrl}" style="background-color: #064e3b; color: #ffffff; padding: 12px 28px; border-radius: 10px; text-decoration: none; font-weight: bold; font-size: 13px; letter-spacing: 1px; display: inline-block; border: 1px solid #10b981; text-transform: uppercase;">
          Rate Your Roast on Coffee Bean ★
        </a>
      </div>
    `;
  }

  const htmlContent = `
    <div style="max-width: 600px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #231815; color: #F5EFC6; border-radius: 16px; overflow: hidden; border: 1px solid #4A2E27;">
      <!-- Header -->
      <div style="background-color: #4D0E12; padding: 24px 20px; text-align: center; border-bottom: 2px solid rgba(245, 239, 198, 0.2);">
        <h1 style="margin: 0; font-size: 22px; letter-spacing: 3px; text-transform: uppercase; color: #F5EFC6;">THE BEAN CO.</h1>
        <p style="margin: 4px 0 0; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #A5BCD6;">ARTISANAL ROASTERY • BENGALURU, INDIA</p>
      </div>

      <!-- Main Body -->
      <div style="padding: 32px 24px; text-align: center;">
        <div style="display: inline-block; padding: 4px 14px; border-radius: 20px; font-size: 10px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #ffffff; background-color: ${badgeColor}; margin-bottom: 16px;">
          ${badgeText}
        </div>

        <h2 style="margin: 0 0 12px; font-size: 24px; color: #F5EFC6; font-weight: 800;">
          ${headline}
        </h2>

        <p style="margin: 0 0 24px; font-size: 13px; line-height: 1.7; color: rgba(245, 239, 198, 0.9); text-align: left;">
          ${leadText}
        </p>

        ${extraContent}

        <!-- Order Summary Card -->
        <div style="background-color: #18100E; border: 1px solid #4A2E27; border-radius: 12px; padding: 18px 20px; margin-bottom: 20px; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #4A2E27; padding-bottom: 10px; margin-bottom: 12px;">
            <span style="font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; color: #A5BCD6; font-weight: 700;">Order #${orderNumber}</span>
            <span style="font-size: 14px; font-weight: 900; color: #34d399;">Total: ₹${totalAmount}</span>
          </div>

          <!-- Items Table -->
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 14px;">
            <thead>
              <tr style="border-bottom: 1px solid #4A2E27;">
                <th style="padding: 6px 12px; font-size: 10px; text-transform: uppercase; color: #A5BCD6; text-align: left;">Item</th>
                <th style="padding: 6px 12px; font-size: 10px; text-transform: uppercase; color: #A5BCD6; text-align: center;">Qty</th>
                <th style="padding: 6px 12px; font-size: 10px; text-transform: uppercase; color: #A5BCD6; text-align: right;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <!-- Shipping Destination -->
          <div style="border-top: 1px solid #4A2E27; padding-top: 10px;">
            <span style="font-size: 10px; text-transform: uppercase; color: #A5BCD6; font-weight: bold; display: block; margin-bottom: 4px;">Destination Address:</span>
            <span style="font-size: 12px; color: #F5EFC6; line-height: 1.5;">${order.shipping_address || 'Registered Shipping Address'}</span>
          </div>
        </div>

        <p style="margin: 0; font-size: 11px; color: rgba(245, 239, 198, 0.5);">
          Questions about your roast? Reply directly to this email or contact <a href="mailto:orders@coffeebean.in" style="color: #A5BCD6;">orders@coffeebean.in</a>.
        </p>
      </div>

      <!-- Footer -->
      <div style="background-color: #18100E; padding: 16px 20px; text-align: center; font-size: 10px; color: rgba(245, 239, 198, 0.4); border-top: 1px solid #4A2E27;">
        © 2026 The Bean Co. Artisanal Roastery • Bengaluru, Karnataka, India • All rights reserved.
      </div>
    </div>
  `;

  let dispatchStatus = 'SIMULATED';
  let gatewayDetails = 'Simulated Roastery Mailer';

  // Live SMTP send
  const mailer = getTransporter();
  if (mailer) {
    try {
      const fromAddress = process.env.SMTP_FROM || `"The Bean Co. Roastery" <${process.env.SMTP_USER.trim()}>`;
      const info = await mailer.sendMail({
        from: fromAddress,
        to: normalizedEmail,
        subject,
        html: htmlContent,
      });
      dispatchStatus = 'SENT';
      gatewayDetails = `SMTP Live Send: ${info.messageId || 'Success'}`;
      console.log(`✅ [Live Email Sent] ${subject} -> ${normalizedEmail}`);
    } catch (mailErr) {
      console.error(`⚠️ [SMTP Live Mail Failed] ${normalizedEmail}:`, mailErr.message);
      gatewayDetails = `SMTP Error: ${mailErr.message}. Fallback to simulated log.`;
    }
  }

  // Simulated logging
  if (dispatchStatus === 'SIMULATED') {
    console.log(`\n========================================================`);
    console.log(`📧 [ROASTERY MAIL SERVICE] ORDER NOTIFICATION`);
    console.log(`✉️ Recipient:      ${normalizedEmail} (${customerName})`);
    console.log(`📦 Order:          #${orderNumber}`);
    console.log(`🏷️ Event:          ${uppercaseEvent}`);
    console.log(`📑 Subject:        ${subject}`);
    if (uppercaseEvent === 'SHIPPED') {
      console.log(`🚚 Courier:        ${courier}`);
      console.log(`🔢 AWB Tracking:   ${trackingNumber}`);
    }
    console.log(`💡 Note: Configure SMTP_HOST/USER/PASS in .env to send real emails.`);
    console.log(`========================================================\n`);
  }

  // Record in order_notifications database table
  try {
    await pool.query(
      `INSERT INTO order_notifications 
       (order_id, order_number, customer_name, recipient_email, channel, event, status, subject, message, gateway_response)
       VALUES (?, ?, ?, ?, 'EMAIL', ?, ?, ?, ?, ?)`,
      [
        order.id,
        orderNumber,
        customerName,
        normalizedEmail,
        uppercaseEvent,
        dispatchStatus,
        subject,
        leadText,
        gatewayDetails
      ]
    );
  } catch (dbErr) {
    console.error('⚠️ Could not save Email notification log to database:', dbErr.message);
  }

  return {
    success: true,
    channel: 'EMAIL',
    status: dispatchStatus,
    email: normalizedEmail,
    subject,
    event: uppercaseEvent
  };
}

module.exports = {
  sendVerificationOTP,
  verifyOTP,
  verifyProofToken,
  generateOTP,
  sendOrderStatusEmail
};

