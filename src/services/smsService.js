const https = require('https');
const { pool } = require('../config/db');

/**
 * Normalizes phone numbers to standard E.164 international format
 * Supports Indian (+91), US/Intl, or standard raw digit inputs
 * @param {string} rawPhone 
 * @returns {string|null}
 */
function normalizePhoneNumber(rawPhone) {
  if (!rawPhone) return null;
  let cleaned = String(rawPhone).trim().replace(/[^\d+]/g, '');
  if (!cleaned) return null;

  // Indian mobile 10-digit number
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    return '+91' + cleaned;
  }
  // 10-digit general
  if (/^\d{10}$/.test(cleaned)) {
    return '+91' + cleaned;
  }
  // Missing leading plus
  if (!cleaned.startsWith('+') && cleaned.length >= 10) {
    return '+' + cleaned;
  }
  return cleaned;
}

/**
 * Generate human-readable, brand-consistent SMS message text
 * @param {Object} order 
 * @param {string} event - 'ORDER_PLACED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED'
 * @returns {string}
 */
function formatSMSMessage(order, event) {
  const customerName = order.customer_name ? order.customer_name.split(' ')[0] : 'Coffee Lover';
  const orderNumber = order.order_number || `ORD-${order.id}`;
  const courier = order.courier_name || 'Express Courier';
  const tracking = order.tracking_number || `ROAST-AWB-${order.id}`;
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const trackingUrl = `${clientUrl}`;

  const estDate = order.estimated_delivery
    ? new Date(order.estimated_delivery).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
    : 'within 2-3 business days';

  switch (event.toUpperCase()) {
    case 'PROCESSING':
    case 'ORDER_PLACED':
      return `☕ The Bean Co: Hello ${customerName}! Your order #${orderNumber} is confirmed & being freshly prepared at the roastery. Est. Delivery: ${estDate}. Track: ${trackingUrl}`;

    case 'SHIPPED':
      return `🚚 The Bean Co: Great news! Your order #${orderNumber} has shipped via ${courier}. AWB Tracking: ${tracking}. Est. Delivery: ${estDate}. Track: ${trackingUrl}`;

    case 'DELIVERED':
      return `✨ The Bean Co: Order #${orderNumber} has been safely delivered to your doorstep! Brew fresh and enjoy your cup. Need help? Contact info@thebean.company`;

    default:
      return `☕ The Bean Co: Update on Order #${orderNumber}: Status is now ${order.status || event}. Track: ${trackingUrl}`;
  }
}

/**
 * Send real SMS via Twilio REST API
 */
async function sendTwilioSMS(toPhone, messageBody) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken || !fromNumber) {
    return { success: false, reason: 'TWILIO_NOT_CONFIGURED' };
  }

  const postData = new URLSearchParams({
    To: toPhone,
    From: fromNumber,
    Body: messageBody
  }).toString();

  const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.twilio.com',
      port: 443,
      path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': authHeader
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, sid: parsed.sid, raw: parsed });
          } else {
            resolve({ success: false, error: parsed.message || 'Twilio Error', raw: parsed });
          }
        } catch (e) {
          resolve({ success: false, error: data });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Send real SMS via Fast2SMS (popular in India)
 */
async function sendFast2SMS(toPhone, messageBody) {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) {
    return { success: false, reason: 'FAST2SMS_NOT_CONFIGURED' };
  }

  // Fast2SMS accepts 10-digit Indian numbers
  const digitsOnly = toPhone.replace(/\D/g, '');
  const tenDigitPhone = digitsOnly.length > 10 ? digitsOnly.slice(-10) : digitsOnly;

  const postData = JSON.stringify({
    route: 'q',
    message: messageBody,
    language: 'english',
    numbers: tenDigitPhone
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'www.fast2sms.com',
      port: 443,
      path: '/dev/bulkV2',
      method: 'POST',
      headers: {
        'authorization': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ success: parsed.return === true, raw: parsed });
        } catch (e) {
          resolve({ success: false, error: data });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Main function: Send Order Status SMS
 * Dispatches real SMS if credentials are present, or falls back to clear simulated dispatch.
 * In all cases, records the SMS dispatch in MariaDB `order_notifications`.
 * 
 * @param {Object} options
 * @param {Object} options.order - Order object
 * @param {string} options.event - 'PROCESSING' | 'SHIPPED' | 'DELIVERED'
 * @param {string} [options.customMessage] - Optional custom message
 * @returns {Promise<Object>}
 */
async function sendOrderStatusSMS({ order, event, customMessage }) {
  if (!order) {
    return { success: false, message: 'Order object is required' };
  }

  const normalizedPhone = normalizePhoneNumber(order.customer_phone);
  if (!normalizedPhone) {
    console.log(`ℹ️ [SMS Skipped] No valid phone number on file for order #${order.order_number}`);
    return {
      success: false,
      skipped: true,
      reason: 'NO_PHONE_NUMBER',
      message: 'No phone number provided for this order'
    };
  }

  const messageText = customMessage || formatSMSMessage(order, event);
  let dispatchStatus = 'SIMULATED';
  let gatewayDetails = 'Simulated Roastery SMS Dispatch';

  // 1. Try Twilio if configured
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const twilioRes = await sendTwilioSMS(normalizedPhone, messageText);
    if (twilioRes.success) {
      dispatchStatus = 'SENT';
      gatewayDetails = `Twilio SID: ${twilioRes.sid}`;
      console.log(`✅ [Twilio SMS] Delivered live SMS to ${normalizedPhone} (SID: ${twilioRes.sid})`);
    } else {
      console.warn(`⚠️ [Twilio SMS Warning] Failed to deliver:`, twilioRes.error);
      gatewayDetails = `Twilio Attempt Failed: ${twilioRes.error || twilioRes.reason}. Fallback to simulated log.`;
    }
  } 
  // 2. Try Fast2SMS if configured
  else if (process.env.FAST2SMS_API_KEY) {
    const fastRes = await sendFast2SMS(normalizedPhone, messageText);
    if (fastRes.success) {
      dispatchStatus = 'SENT';
      gatewayDetails = 'Fast2SMS Delivered';
      console.log(`✅ [Fast2SMS] Delivered live SMS to ${normalizedPhone}`);
    } else {
      console.warn(`⚠️ [Fast2SMS Warning] Failed to deliver:`, fastRes.error);
      gatewayDetails = `Fast2SMS Failed: ${fastRes.error || fastRes.reason}. Fallback to simulated log.`;
    }
  }

  // If in simulated mode (no live SMS credentials or test mode)
  if (dispatchStatus === 'SIMULATED') {
    console.log(`\n========================================================`);
    console.log(`📱 [ROASTERY SMS GATEWAY] ORDER STATUS NOTIFICATION`);
    console.log(`📞 Recipient:      ${normalizedPhone} (${order.customer_name || 'Customer'})`);
    console.log(`📦 Order:          #${order.order_number}`);
    console.log(`🏷️ Event:          ${event.toUpperCase()}`);
    if (event.toUpperCase() === 'SHIPPED') {
      console.log(`🚚 Courier:        ${order.courier_name || 'Express Logistics'}`);
      console.log(`🔢 AWB Tracking:   ${order.tracking_number || 'N/A'}`);
    }
    console.log(`💬 SMS Content:\n"${messageText}"`);
    console.log(`💡 Note: Configure TWILIO_* or FAST2SMS_API_KEY in .env for real SMS transmission.`);
    console.log(`========================================================\n`);
  }

  // Record notification in order_notifications table
  try {
    await pool.query(
      `INSERT INTO order_notifications 
       (order_id, order_number, customer_name, recipient_phone, channel, event, status, subject, message, gateway_response)
       VALUES (?, ?, ?, ?, 'SMS', ?, ?, ?, ?, ?)`,
      [
        order.id,
        order.order_number,
        order.customer_name || 'Customer',
        normalizedPhone,
        event.toUpperCase(),
        dispatchStatus,
        `SMS Alert: ${event.toUpperCase()}`,
        messageText,
        gatewayDetails
      ]
    );
  } catch (dbErr) {
    console.error('⚠️ Could not save SMS notification log to database:', dbErr.message);
  }

  return {
    success: true,
    channel: 'SMS',
    status: dispatchStatus,
    phone: normalizedPhone,
    message: messageText,
    event: event.toUpperCase()
  };
}

module.exports = {
  sendOrderStatusSMS,
  normalizePhoneNumber,
  formatSMSMessage
};
