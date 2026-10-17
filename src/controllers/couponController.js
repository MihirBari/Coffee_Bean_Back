const { pool } = require('../config/db');

// Helper to generate a random friend coupon code
function generateRandomCode(prefix = 'BEAN') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${rand}`;
}

// 1. Get all coupons (Admin only)
exports.getAllCoupons = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM coupons ORDER BY id DESC');
    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error('Error fetching coupons:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving coupons', error: error.message });
  }
};

// 2. Create new coupon (Admin only)
exports.createCoupon = async (req, res) => {
  try {
    let { 
      code, 
      discount_percent, 
      description, 
      max_uses = 100, 
      min_order_amount = 0, 
      expires_at = null,
      is_active = 1 
    } = req.body;

    if (!code || !code.trim()) {
      code = generateRandomCode('FRIEND');
    } else {
      code = code.trim().toUpperCase().replace(/\s+/g, '');
    }

    const discount = parseInt(discount_percent, 10);
    if (isNaN(discount) || discount <= 0 || discount > 100) {
      return res.status(400).json({ success: false, message: 'Discount percentage must be between 1 and 100' });
    }

    // Check if code already exists
    const [existing] = await pool.query('SELECT id FROM coupons WHERE code = ?', [code]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: `Coupon code "${code}" already exists` });
    }

    const [result] = await pool.query(
      `INSERT INTO coupons (code, discount_percent, description, max_uses, min_order_amount, expires_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        discount,
        description || `Special ${discount}% off friend discount`,
        parseInt(max_uses, 10) || 100,
        parseFloat(min_order_amount) || 0,
        expires_at || null,
        is_active ? 1 : 0
      ]
    );

    const [created] = await pool.query('SELECT * FROM coupons WHERE id = ?', [result.insertId]);
    res.status(201).json({
      success: true,
      message: `Coupon code "${code}" created successfully!`,
      data: created[0]
    });
  } catch (error) {
    console.error('Error creating coupon:', error);
    res.status(500).json({ success: false, message: 'Server error creating coupon', error: error.message });
  }
};

// 3. Update coupon (Admin only)
exports.updateCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    const { code, discount_percent, description, max_uses, min_order_amount, expires_at, is_active } = req.body;

    const [existing] = await pool.query('SELECT * FROM coupons WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }

    let finalCode = existing[0].code;
    if (code) {
      finalCode = code.trim().toUpperCase().replace(/\s+/g, '');
      // Check duplicate
      const [dupe] = await pool.query('SELECT id FROM coupons WHERE code = ? AND id != ?', [finalCode, id]);
      if (dupe.length > 0) {
        return res.status(400).json({ success: false, message: `Coupon code "${finalCode}" is already taken` });
      }
    }

    await pool.query(
      `UPDATE coupons SET 
         code = ?,
         discount_percent = ?,
         description = ?,
         max_uses = ?,
         min_order_amount = ?,
         expires_at = ?,
         is_active = ?
       WHERE id = ?`,
      [
        finalCode,
        discount_percent !== undefined ? parseInt(discount_percent, 10) : existing[0].discount_percent,
        description !== undefined ? description : existing[0].description,
        max_uses !== undefined ? parseInt(max_uses, 10) : existing[0].max_uses,
        min_order_amount !== undefined ? parseFloat(min_order_amount) : existing[0].min_order_amount,
        expires_at !== undefined ? (expires_at || null) : existing[0].expires_at,
        is_active !== undefined ? (is_active ? 1 : 0) : existing[0].is_active,
        id
      ]
    );

    const [updated] = await pool.query('SELECT * FROM coupons WHERE id = ?', [id]);
    res.json({ success: true, message: 'Coupon updated successfully', data: updated[0] });
  } catch (error) {
    console.error('Error updating coupon:', error);
    res.status(500).json({ success: false, message: 'Server error updating coupon', error: error.message });
  }
};

// 4. Delete coupon (Admin only)
exports.deleteCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await pool.query('SELECT * FROM coupons WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }

    await pool.query('DELETE FROM coupons WHERE id = ?', [id]);
    res.json({ success: true, message: `Coupon "${existing[0].code}" deleted successfully` });
  } catch (error) {
    console.error('Error deleting coupon:', error);
    res.status(500).json({ success: false, message: 'Server error deleting coupon', error: error.message });
  }
};

// 5. Validate coupon (Public - Customer / Friend entering in Cart)
exports.validateCoupon = async (req, res) => {
  try {
    const { code, subtotal = 0 } = req.body;
    if (!code || !code.trim()) {
      return res.status(400).json({ success: false, valid: false, message: 'Please enter a coupon code' });
    }

    const cleanCode = code.trim().toUpperCase().replace(/\s+/g, '');
    const [rows] = await pool.query('SELECT * FROM coupons WHERE code = ?', [cleanCode]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, valid: false, message: `Coupon code "${cleanCode}" is invalid` });
    }

    const coupon = rows[0];

    // Check if active
    if (!coupon.is_active) {
      return res.status(400).json({ success: false, valid: false, message: `Coupon code "${cleanCode}" is currently inactive` });
    }

    // Check usage limit
    if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
      return res.status(400).json({ success: false, valid: false, message: `Coupon code "${cleanCode}" has reached maximum usage limit` });
    }

    // Check expiration date
    if (coupon.expires_at) {
      const expiryDate = new Date(coupon.expires_at);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (expiryDate < today) {
        return res.status(400).json({ success: false, valid: false, message: `Coupon code "${cleanCode}" expired on ${expiryDate.toLocaleDateString()}` });
      }
    }

    // Check minimum order amount
    const cartSubtotal = parseFloat(subtotal) || 0;
    if (coupon.min_order_amount && cartSubtotal < parseFloat(coupon.min_order_amount)) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: `Coupon "${cleanCode}" requires a minimum order subtotal of $${parseFloat(coupon.min_order_amount).toFixed(2)}`
      });
    }

    res.json({
      success: true,
      valid: true,
      code: coupon.code,
      discount_percent: coupon.discount_percent,
      description: coupon.description,
      message: `Promo code applied: ${coupon.discount_percent}% OFF! (${coupon.description || 'Special Discount'})`
    });
  } catch (error) {
    console.error('Error validating coupon:', error);
    res.status(500).json({ success: false, message: 'Server error validating coupon', error: error.message });
  }
};
