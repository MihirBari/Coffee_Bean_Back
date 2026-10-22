const { pool } = require('../config/db');
const { notifyCustomerOrderEvent } = require('../services/notificationService');

// 1. Get authenticated customer's orders
exports.getMyOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;

    const [orders] = await pool.query(
      `SELECT * FROM orders 
       WHERE user_id = ? OR customer_email = ? 
       ORDER BY id DESC`,
      [userId, userEmail]
    );

    for (const order of orders) {
      const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
      order.items = items;
      // Check if return request exists
      const [returns] = await pool.query('SELECT * FROM return_requests WHERE order_id = ? ORDER BY id DESC LIMIT 1', [order.id]);
      order.return_request = returns.length > 0 ? returns[0] : null;
    }

    res.json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    console.error('Error fetching customer orders:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving orders', error: error.message });
  }
};

// 2. Get Visual Tracking Details for an order
exports.getOrderTracking = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const [orders] = await pool.query('SELECT * FROM orders WHERE order_number = ?', [orderNumber]);

    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order tracking number not found' });
    }

    const order = orders[0];
    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    order.items = items;

    // Timeline steps metadata
    const steps = [
      { step: 1, title: 'Order Confirmed', desc: 'Specialty Arabica extraction scheduled' },
      { step: 2, title: 'Packed at Roastery', desc: 'Canisters sealed with airtight freshness stamp' },
      { step: 3, title: 'Dispatched to Courier', desc: `Handed over to ${order.courier_name || 'Express Logistics'}` },
      { step: 4, title: 'Out for Doorstep Delivery', desc: 'Courier agent en-route with express parcel' },
      { step: 5, title: 'Delivered', desc: 'Handed over to customer' }
    ];

    res.json({
      success: true,
      data: {
        order,
        current_step: order.order_step || 2,
        tracking_number: order.tracking_number || `ROAST-AWB-${order.id}9482`,
        courier_name: order.courier_name || 'Roastery Express Courier',
        estimated_delivery: order.estimated_delivery,
        steps
      }
    });
  } catch (error) {
    console.error('Error fetching order tracking:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving tracking', error: error.message });
  }
};

// 3. Create a Customer Return Request
exports.createReturnRequest = async (req, res) => {
  try {
    const { order_id, order_number, reason, details } = req.body;
    let imageUrl = req.body.image_url || null;
    if (req.file) {
      imageUrl = req.file.path?.startsWith('http')
        ? req.file.path
        : `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    }
    const userId = req.user ? req.user.id : null;
    const customerName = req.user ? req.user.name : req.body.customer_name;
    const customerEmail = req.user ? req.user.email : req.body.customer_email;

    if (!order_id || !order_number || !reason) {
      return res.status(400).json({ success: false, message: 'Order ID, order number, and return reason are required' });
    }

    // Verify order exists
    const [orderRows] = await pool.query('SELECT id, status FROM orders WHERE id = ?', [order_id]);
    if (orderRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const [result] = await pool.query(`
      INSERT INTO return_requests 
      (order_id, order_number, user_id, customer_name, customer_email, reason, details, image_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending')
    `, [order_id, order_number, userId, customerName, customerEmail, reason, details || '', imageUrl]);

    const [newRequest] = await pool.query('SELECT * FROM return_requests WHERE id = ?', [result.insertId]);

    res.status(201).json({
      success: true,
      message: 'Return / Replacement request registered successfully. Our roastery team will review within 2 hours.',
      data: newRequest[0]
    });
  } catch (error) {
    console.error('Error creating return request:', error);
    res.status(500).json({ success: false, message: 'Server error creating return request', error: error.message });
  }
};

// 4. Admin: Get all Return Requests
exports.getReturnRequests = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.*, o.total_amount, o.created_at AS order_date, o.payment_method
      FROM return_requests r
      LEFT JOIN orders o ON r.order_id = o.id
      ORDER BY r.id DESC
    `);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error('Error fetching return requests:', error);
    res.status(500).json({ success: false, message: 'Server error fetching return requests', error: error.message });
  }
};

// 5. Admin: Update Return Request Status
exports.updateReturnRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, resolution_notes } = req.body;

    await pool.query(
      'UPDATE return_requests SET status = ?, resolution_notes = ? WHERE id = ?',
      [status, resolution_notes || '', id]
    );

    const [updated] = await pool.query('SELECT * FROM return_requests WHERE id = ?', [id]);
    res.json({ success: true, message: 'Return request updated', data: updated[0] });
  } catch (error) {
    console.error('Error updating return request:', error);
    res.status(500).json({ success: false, message: 'Server error updating return request', error: error.message });
  }
};

// 6. Admin: Update Order Shipping Stage & AWB Code, with automatic Mail & SMS dispatch
exports.updateOrderTracking = async (req, res) => {
  try {
    const { id } = req.params;
    let { tracking_number, courier_name, order_step, status, estimated_delivery } = req.body;

    const [existing] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Automatically align status with order_step if status not explicitly specified
    if (order_step !== undefined && status === undefined) {
      const stepNum = parseInt(order_step, 10);
      if (stepNum === 2) status = 'Processing';
      else if (stepNum === 3 || stepNum === 4) status = 'Shipped';
      else if (stepNum === 5) status = 'Delivered';
    }

    // Automatically align order_step with status if status was provided but order_step wasn't
    if (status !== undefined && order_step === undefined) {
      if (status === 'Processing') order_step = 2;
      else if (status === 'Shipped') order_step = 3;
      else if (status === 'Delivered') order_step = 5;
    }

    const updates = [];
    const params = [];

    if (tracking_number !== undefined) { updates.push('tracking_number = ?'); params.push(tracking_number); }
    if (courier_name !== undefined) { updates.push('courier_name = ?'); params.push(courier_name); }
    if (order_step !== undefined) { updates.push('order_step = ?'); params.push(parseInt(order_step, 10)); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (estimated_delivery !== undefined) { updates.push('estimated_delivery = ?'); params.push(estimated_delivery); }

    if (updates.length > 0) {
      params.push(id);
      await pool.query(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    const [updated] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [id]);
    updated[0].items = items;

    // Trigger Email & SMS notification if status is Shipped, Delivered, or Processing
    let notificationResult = null;
    const targetStatus = status || updated[0].status;
    if (['Shipped', 'Delivered', 'Processing'].includes(targetStatus)) {
      notificationResult = await notifyCustomerOrderEvent(updated[0], targetStatus.toUpperCase());
    }

    // Include updated notification history in response
    const [notifications] = await pool.query('SELECT * FROM order_notifications WHERE order_id = ? ORDER BY id DESC', [id]);
    updated[0].notifications = notifications;

    res.json({
      success: true,
      message: `Fulfillment updated for #${updated[0].order_number}. 📧 Mail & 📱 SMS sent to customer!`,
      data: updated[0],
      notifications: notificationResult
    });
  } catch (error) {
    console.error('Error updating order tracking:', error);
    res.status(500).json({ success: false, message: 'Server error updating tracking', error: error.message });
  }
};


// 7. Customer Saved Addresses
exports.getAddresses = async (req, res) => {
  try {
    let userId = req.user ? req.user.id : null;
    const emailParam = (req.query?.email || (req.user ? req.user.email : '')).trim().toLowerCase();

    if (!userId && emailParam) {
      const [uRows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [emailParam]);
      if (uRows.length > 0) {
        userId = uRows[0].id;
      }
    }

    if (!userId) {
      return res.json({ success: true, data: [] });
    }

    const [rows] = await pool.query(
      `SELECT DISTINCT ca.* FROM customer_addresses ca
       LEFT JOIN users u ON ca.user_id = u.id
       WHERE ca.user_id = ? OR LOWER(TRIM(u.email)) = ?
       ORDER BY ca.is_default DESC, ca.id DESC`,
      [userId, emailParam]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addAddress = async (req, res) => {
  try {
    let userId = req.user ? req.user.id : null;
    const {
      email,
      label,
      recipient_name,
      phone,
      address_line,
      house_flat,
      street_locality,
      city,
      state,
      pincode,
      is_default
    } = req.body;

    const emailParam = (email || (req.user ? req.user.email : '')).trim().toLowerCase();

    if (!userId && emailParam) {
      const [uRows] = await pool.query('SELECT id, name, phone FROM users WHERE email = ? LIMIT 1', [emailParam]);
      if (uRows.length > 0) {
        userId = uRows[0].id;
      } else {
        const [newUser] = await pool.query(
          'INSERT INTO users (name, email, role, is_email_verified) VALUES (?, ?, "customer", 1)',
          [recipient_name || 'Customer', emailParam]
        );
        userId = newUser.insertId;
      }
    }

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Customer account or email is required to save address' });
    }

    const resolvedName = (recipient_name || req.user?.name || 'Customer').trim();
    const resolvedPhone = (phone || req.user?.phone || '').trim();
    const finalAddressLine = (address_line || [house_flat, street_locality, city, state].filter(Boolean).join(', ')).trim();

    if ((!finalAddressLine && !street_locality) || !pincode) {
      return res.status(400).json({ success: false, message: 'Street/locality and pincode are required' });
    }

    // Check if identical address already exists for this user to avoid duplicates
    const [existing] = await pool.query(
      `SELECT * FROM customer_addresses 
       WHERE user_id = ? AND (
         LOWER(TRIM(address_line)) = LOWER(?) OR 
         (pincode = ? AND LOWER(TRIM(street_locality)) = LOWER(?) AND LOWER(TRIM(house_flat)) = LOWER(?))
       ) LIMIT 1`,
      [userId, finalAddressLine, pincode, (street_locality || '').trim(), (house_flat || '').trim()]
    );

    if (existing && existing.length > 0) {
      return res.status(200).json({ success: true, message: 'Address already in saved book', data: existing[0] });
    }

    if (is_default) {
      await pool.query('UPDATE customer_addresses SET is_default = 0 WHERE user_id = ?', [userId]);
    }

    const [result] = await pool.query(`
      INSERT INTO customer_addresses (user_id, label, recipient_name, phone, address_line, house_flat, street_locality, city, state, pincode, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      label || 'Delivery Address',
      resolvedName,
      resolvedPhone,
      finalAddressLine,
      house_flat || '',
      street_locality || '',
      city || '',
      state || '',
      pincode,
      is_default ? 1 : 0
    ]);

    const [newAddr] = await pool.query('SELECT * FROM customer_addresses WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, message: 'Address saved successfully', data: newAddr[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    await pool.query('DELETE FROM customer_addresses WHERE id = ? AND user_id = ?', [id, userId]);
    res.json({ success: true, message: 'Address removed' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 8. Bean Coins Loyalty Wallet
exports.getWallet = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.query('SELECT * FROM bean_coins_wallets WHERE user_id = ?', [userId]);
    let balance = 150; // Welcome reward
    if (rows.length === 0) {
      await pool.query('INSERT INTO bean_coins_wallets (user_id, balance) VALUES (?, 150)', [userId]);
    } else {
      balance = rows[0].balance;
    }
    res.json({
      success: true,
      data: {
        balance,
        rupee_value: balance, // 1 Bean Coin = ₹1
        earning_rate: '5% of order value',
        welcome_bonus: '150 Coins Awarded'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 9. Community Q&A
exports.getProductQuestions = async (req, res) => {
  try {
    const { productId } = req.params;
    const [rows] = await pool.query('SELECT * FROM product_questions WHERE product_id = ? ORDER BY id DESC', [productId]);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.askQuestion = async (req, res) => {
  try {
    const { product_id, user_name, question } = req.body;
    if (!product_id || !question) {
      return res.status(400).json({ success: false, message: 'Product ID and question are required' });
    }

    const name = user_name || (req.user ? req.user.name : 'Coffee Enthusiast');
    const [result] = await pool.query(
      'INSERT INTO product_questions (product_id, user_name, question) VALUES (?, ?, ?)',
      [product_id, name, question.trim()]
    );

    const [newQ] = await pool.query('SELECT * FROM product_questions WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, message: 'Question submitted! Our roasters will answer shortly.', data: newQ[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.answerQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const { answer, answered_by } = req.body;

    await pool.query(
      'UPDATE product_questions SET answer = ?, answered_by = ? WHERE id = ?',
      [answer, answered_by || 'Master Roaster', id]
    );

    const [updated] = await pool.query('SELECT * FROM product_questions WHERE id = ?', [id]);
    res.json({ success: true, message: 'Answer published', data: updated[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 10. Admin: Customer CRM 360 Aggregation
exports.getCRMCustomers = async (req, res) => {
  try {
    const [customers] = await pool.query(`
      SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.created_at,
        u.is_email_verified,
        u.email_verified_at,
        COUNT(o.id) AS total_orders,
        COALESCE(SUM(o.total_amount), 0) AS lifetime_value,
        COALESCE(MAX(o.created_at), u.created_at) AS last_order_date,
        COALESCE(w.balance, 150) AS bean_coins_balance
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      LEFT JOIN bean_coins_wallets w ON u.id = w.user_id
      WHERE u.role = 'customer'
      GROUP BY u.id
      ORDER BY lifetime_value DESC
    `);

    const formatted = customers.map((c) => ({
      ...c,
      is_email_verified: c.is_email_verified === 1,
      lifetime_value: parseFloat(c.lifetime_value),
      total_orders: parseInt(c.total_orders, 10),
      tier: c.total_orders >= 3 || c.lifetime_value >= 1500 ? '👑 VIP Champion' : c.total_orders >= 1 ? '🌟 Active Customer' : '🌱 New Member'
    }));

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: Toggle or Set Customer Email Verification Status in MariaDB
exports.verifyCustomerEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_verified } = req.body;
    const val = is_verified !== undefined ? (is_verified ? 1 : 0) : 1;
    await pool.query('UPDATE users SET is_email_verified = ?, email_verified_at = CURRENT_TIMESTAMP WHERE id = ?', [val, id]);
    const [updated] = await pool.query('SELECT id, name, email, is_email_verified, email_verified_at FROM users WHERE id = ?', [id]);
    res.json({ success: true, message: `Customer verification updated to ${val ? 'Verified' : 'Unverified'}`, data: updated[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 11. Admin: Bulk CSV Export for Orders
exports.exportOrdersCSV = async (req, res) => {
  try {
    const [orders] = await pool.query('SELECT * FROM orders ORDER BY id DESC');
    let csv = 'Order ID,Order Number,Customer Name,Email,Phone,Total Amount (INR),Shipping Fee,Status,Payment Method,Created At,Tracking Number,Courier\n';

    orders.forEach((o) => {
      const line = [
        o.id,
        `"${o.order_number}"`,
        `"${o.customer_name}"`,
        `"${o.customer_email}"`,
        `"${o.customer_phone || ''}"`,
        o.total_amount,
        o.shipping_fee || 0,
        o.status,
        `"${o.payment_method}"`,
        `"${new Date(o.created_at).toISOString()}"`,
        `"${o.tracking_number || ''}"`,
        `"${o.courier_name || ''}"`
      ].join(',');
      csv += line + '\n';
    });

    res.header('Content-Type', 'text/csv');
    res.attachment(`CoffeeBean_Orders_Export_${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 12. Admin: Bulk CSV Export for Inventory
exports.exportInventoryCSV = async (req, res) => {
  try {
    const [products] = await pool.query('SELECT * FROM products ORDER BY id ASC');
    let csv = 'Product ID,Name,Roast Level,Price (INR),Stock Quantity,Featured,Origin,Flavor Notes\n';

    products.forEach((p) => {
      const line = [
        p.id,
        `"${p.name.replace(/"/g, '""')}"`,
        p.roast_level,
        p.price,
        p.stock_quantity,
        p.is_featured ? 'Yes' : 'No',
        `"${p.origin || ''}"`,
        `"${(p.flavor_notes || '').replace(/"/g, '""')}"`
      ].join(',');
      csv += line + '\n';
    });

    res.header('Content-Type', 'text/csv');
    res.attachment(`CoffeeBean_Inventory_Export_${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
