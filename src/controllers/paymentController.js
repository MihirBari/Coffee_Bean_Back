const Razorpay = require('razorpay');
const crypto = require('crypto');
const { pool } = require('../config/db');

/**
 * Returns active Razorpay SDK client if credentials are configured in .env,
 * or null for mock/placeholder mode until keys are provided.
 */
function getRazorpayClient() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

  if (keyId && keySecret) {
    try {
      return new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
      });
    } catch (err) {
      console.error('Failed to initialize Razorpay SDK client:', err.message);
      return null;
    }
  }
  return null;
}

/**
 * Get Public Payment Gateway Configuration
 * GET /api/payment/config
 */
exports.getPaymentConfig = (req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() || null;
  const isConfigured = Boolean(keyId && process.env.RAZORPAY_KEY_SECRET?.trim());

  res.json({
    success: true,
    provider: 'razorpay',
    is_configured: isConfigured,
    key_id: keyId || 'rzp_test_placeholder',
    currency: 'INR',
    message: isConfigured 
      ? 'Razorpay credentials active.' 
      : 'Razorpay embedded in readiness mode. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to Back/.env to activate live payments.'
  });
};

/**
 * Create Razorpay Order
 * POST /api/payment/razorpay/create-order
 * @body { amount: number (INR), receipt: string, notes: object, currency: string }
 */
exports.createRazorpayOrder = async (req, res) => {
  try {
    const { amount, receipt, notes = {}, currency = 'INR' } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid payment amount is required' });
    }

    // Razorpay amount is calculated in Paise (1 INR = 100 Paise)
    const amountInPaise = Math.round(Number(amount) * 100);
    const receiptId = receipt || `rcpt_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const rzp = getRazorpayClient();

    if (rzp) {
      // Live / Sandbox Razorpay API call
      const options = {
        amount: amountInPaise,
        currency,
        receipt: receiptId.slice(0, 40), // Razorpay receipt max 40 chars
        notes: {
          app: 'Coffee Bean Artisanal Roastery',
          ...notes,
        },
      };

      const razorpayOrder = await rzp.orders.create(options);
      console.log(`✅ [Razorpay Gateway] Created order ${razorpayOrder.id} for ₹${amount} (${amountInPaise} paise)`);

      return res.json({
        success: true,
        is_live_gateway: true,
        order_id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        key_id: process.env.RAZORPAY_KEY_ID,
        receipt: razorpayOrder.receipt,
      });
    }

    // Readiness / Mock Sandbox Mode (Allows testing full UI & order flow before user enters keys)
    const mockOrderId = `order_mock_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    console.log(`ℹ️ [Razorpay Readiness Mode] Generated mock order ${mockOrderId} for ₹${amount}. Add credentials to .env to switch to real Razorpay API.`);

    res.json({
      success: true,
      is_live_gateway: false,
      order_id: mockOrderId,
      amount: amountInPaise,
      currency,
      key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder',
      receipt: receiptId,
      notice: 'Razorpay embedded. Add RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET to Back/.env to process via Razorpay servers.'
    });
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create payment order with Razorpay', 
      error: error.message 
    });
  }
};

/**
 * Verify Razorpay Cryptographic Payment Signature
 * POST /api/payment/razorpay/verify
 * @body { razorpay_order_id, razorpay_payment_id, razorpay_signature, internal_order_id }
 */
exports.verifyRazorpayPayment = async (req, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature, 
      internal_order_id 
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing razorpay_order_id or razorpay_payment_id' 
      });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    let isSignatureValid = false;

    if (keySecret && !razorpay_order_id.startsWith('order_mock_')) {
      // Official HMAC SHA-256 signature verification according to Razorpay security specs
      const generatedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      isSignatureValid = (generatedSignature === razorpay_signature);

      if (!isSignatureValid) {
        console.warn(`⚠️ [Razorpay Verification] Signature mismatch for order ${razorpay_order_id}!`);
        return res.status(400).json({
          success: false,
          message: 'Payment verification failed: Invalid cryptographic signature.'
        });
      }
    } else {
      // In Mock / Placeholder mode before credentials are provided, validate mock flow
      isSignatureValid = true;
      console.log(`ℹ️ [Razorpay Mock Verification] Verified payment simulation for order ${razorpay_order_id}`);
    }

    // Update order status in MariaDB if internal order id provided
    if (internal_order_id) {
      await pool.query(
        `UPDATE orders 
         SET razorpay_order_id = ?, 
             razorpay_payment_id = ?, 
             razorpay_signature = ?, 
             payment_status = 'paid'
         WHERE id = ? OR order_number = ?`,
        [
          razorpay_order_id, 
          razorpay_payment_id, 
          razorpay_signature || 'mock_sig', 
          internal_order_id, 
          internal_order_id
        ]
      );
    }

    res.json({
      success: true,
      verified: true,
      message: 'Payment verified and confirmed successfully!',
      payment_id: razorpay_payment_id,
      order_id: razorpay_order_id
    });
  } catch (error) {
    console.error('Error verifying Razorpay payment:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to verify payment signature', 
      error: error.message 
    });
  }
};
