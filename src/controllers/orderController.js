const { pool } = require('../config/db');
const { verifyProofToken, verifyOTP } = require('../services/emailService');
const { notifyCustomerOrderEvent, getOrderNotificationHistory } = require('../services/notificationService');
const { isDisposableEmail, isValidEmail, logSecurityEvent } = require('../middleware/botProtection');

// Create a new order with transaction, stock deduction, and email verification protection
exports.createOrder = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      customer_name,
      customer_email,
      customer_phone,
      shipping_address,
      items,
      payment_method,
      notes,
      verification_token,
      email_otp
    } = req.body;

    const clientIp = req.ip || req.connection.remoteAddress || '127.0.0.1';

    if (!customer_name || !customer_email || !shipping_address || !items || !items.length) {
      return res.status(400).json({
        success: false,
        message: 'Customer name, email, shipping address, and at least one item are required'
      });
    }

    const normalizedEmail = customer_email.trim().toLowerCase();

    // 1. Email Syntax Validation
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid, well-formed email address.'
      });
    }

    // 2. Shipping Criteria Enforcement: Domestic India Delivery Only
    // Validates that shipping address contains a 6-digit Indian PIN code (100001 - 999999)
    const pinMatch = (shipping_address || '').match(/\b([1-9][0-9]{5})\b/);
    if (!pinMatch) {
      return res.status(400).json({
        success: false,
        error_code: 'INDIA_ONLY_SHIPPING',
        message: 'We currently only ship within India. Please provide a valid 6-digit Indian Postal PIN code (e.g. 560001, 110001). International orders are not supported.'
      });
    }

    // 2. Disposable / Burner Email Rejection (Stops throwaway email fraud)
    if (isDisposableEmail(normalizedEmail)) {
      await logSecurityEvent('DISPOSABLE_EMAIL_BLOCKED', 'BLOCKED_ATTACK', clientIp, normalizedEmail, 'Order blocked: disposable burner domain.');
      return res.status(400).json({
        success: false,
        error_code: 'DISPOSABLE_EMAIL_REJECTED',
        message: 'Disposable or temporary email domains are not accepted. Please use a genuine email address to place orders.'
      });
    }

    // 3. Email Verification Enforcement (Once verified, NEVER ask again!)
    let isEmailVerified = false;
    let verificationMethod = 'NONE';

    // Check A: Customer is signed in and account email is verified
    if (req.user && req.user.email && req.user.email.toLowerCase() === normalizedEmail) {
      const [uRows] = await pool.query('SELECT is_email_verified FROM users WHERE id = ?', [req.user.id]);
      if (uRows.length > 0 && uRows[0].is_email_verified) {
        isEmailVerified = true;
        verificationMethod = 'AUTHENTICATED_ACCOUNT';
      }
    }

    // Check B: The email belongs to an existing verified account in the users table
    if (!isEmailVerified) {
      const [uRows] = await pool.query('SELECT is_email_verified FROM users WHERE email = ? AND is_email_verified = 1', [normalizedEmail]);
      if (uRows.length > 0) {
        isEmailVerified = true;
        verificationMethod = 'REGISTERED_VERIFIED_CUSTOMER';
      }
    }

    // Check C: The email has previously verified an OTP in history (once verified, no repeat needed)
    if (!isEmailVerified) {
      const [vRows] = await pool.query('SELECT id FROM email_verifications WHERE email = ? AND is_used = 1 LIMIT 1', [normalizedEmail]);
      if (vRows.length > 0) {
        isEmailVerified = true;
        verificationMethod = 'PRIOR_OTP_VERIFIED';
      }
    }

    // Check D: Signed verification proof token provided
    if (!isEmailVerified && verification_token) {
      if (verifyProofToken(verification_token, normalizedEmail)) {
        isEmailVerified = true;
        verificationMethod = 'EMAIL_OTP_TOKEN';
      }
    }

    // Check E: Inline 6-digit verification code provided
    if (!isEmailVerified && email_otp) {
      const verifyRes = await verifyOTP(normalizedEmail, email_otp, 'order_checkout');
      if (verifyRes.success) {
        isEmailVerified = true;
        verificationMethod = 'EMAIL_OTP_INLINE';
      }
    }

    // BLOCK ORDER if email is unverified!
    if (!isEmailVerified) {
      await logSecurityEvent(
        'UNVERIFIED_ORDER_BLOCKED',
        'WARNING',
        clientIp,
        normalizedEmail,
        'Order placement rejected: email address unverified. Protects roastery stock & prevents bot spam.'
      );

      return res.status(400).json({
        success: false,
        error_code: 'EMAIL_VERIFICATION_REQUIRED',
        message: 'Email verification is required before confirming your order. Please click "Verify Email" to receive your 6-digit confirmation code.'
      });
    }

    // 4. Anti-Inventory Draining Safety Cap (Max 25 tins per line item per consumer order)
    for (const item of items) {
      const qty = parseInt(item.quantity, 10) || 1;
      if (qty > 25) {
        return res.status(400).json({
          success: false,
          message: 'Order quantity per item exceeds the standard retail limit (25 canisters). Please contact roastery wholesale for bulk corporate purchases.'
        });
      }
    }

    await connection.beginTransaction();

    let calculatedTotal = 0;
    const validatedItems = [];

    // Check stocks and calculate totals
    for (const item of items) {
      const [prodRows] = await connection.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [item.product_id]);
      if (prodRows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: `Product ID ${item.product_id} not found` });
      }

      const product = prodRows[0];
      const qty = parseInt(item.quantity, 10) || 1;

      if (product.stock_quantity < qty) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for "${product.name}". Available: ${product.stock_quantity}, requested: ${qty}`
        });
      }

      const unitPrice = parseFloat(product.price);
      const subtotal = unitPrice * qty;
      calculatedTotal += subtotal;

      validatedItems.push({
        product_id: product.id,
        product_name: product.name,
        quantity: qty,
        unit_price: unitPrice,
        grind_type: item.grind_type || 'Whole Bean',
        subtotal: subtotal
      });

      // Deduct stock
      await connection.query('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?', [qty, product.id]);
    }

    // Generate unique order number: CB-2026-[random 5 digits]
    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    const orderNumber = `CB-2026-${randomSuffix}`;

    // Resolve customer user account so orders and delivery address book are always linked
    let resolvedUserId = req.user ? req.user.id : null;
    if (!resolvedUserId && normalizedEmail) {
      const [uRows] = await connection.query('SELECT id FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);
      if (uRows.length > 0) {
        resolvedUserId = uRows[0].id;
      } else {
        const [newUser] = await connection.query(
          'INSERT INTO users (name, email, role, is_email_verified) VALUES (?, ?, "customer", 1)',
          [customer_name || 'Customer', normalizedEmail]
        );
        resolvedUserId = newUser.insertId;
      }
    }

    const userId = resolvedUserId;
    const shippingFee = parseFloat(req.body.shipping_fee) || 0;
    const discountAmount = parseFloat(req.body.discount_amount) || 0;
    const finalOrderTotal = Math.max(0, calculatedTotal - discountAmount + shippingFee);

    const razorpayOrderId = req.body.razorpay_order_id || null;
    const razorpayPaymentId = req.body.razorpay_payment_id || null;
    const razorpaySignature = req.body.razorpay_signature || null;
    const paymentStatus = razorpayPaymentId ? 'paid' : (req.body.payment_status || 'pending');

    const [orderResult] = await connection.query(
      `INSERT INTO orders 
      (order_number, user_id, customer_name, customer_email, customer_phone, shipping_address, total_amount, shipping_fee, discount_amount, status, payment_method, notes, is_verified, verification_method, client_ip, security_risk_score, razorpay_order_id, razorpay_payment_id, razorpay_signature, payment_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderNumber,
        userId,
        customer_name,
        normalizedEmail,
        customer_phone || '',
        shipping_address,
        finalOrderTotal,
        shippingFee,
        discountAmount,
        'Pending',
        payment_method || 'Razorpay (Protected)',
        notes || '',
        1,
        verificationMethod,
        clientIp,
        0,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        paymentStatus
      ]
    );

    const orderId = orderResult.insertId;

    // Auto-save shipping address to customer's delivery address book
    let autoSavedAddress = null;
    if (userId && shipping_address) {
      try {
        const pinMatch = (shipping_address || '').match(/\b([1-9][0-9]{5})\b/);
        const pin = (req.body.shipping_parts?.pincode || (pinMatch ? pinMatch[1] : '')).trim();
        const cleanShippingAddr = shipping_address.trim();

        // Check if identical address line already exists in customer_addresses for this user
        const [existingAddr] = await connection.query(
          `SELECT * FROM customer_addresses 
           WHERE user_id = ? AND (
             LOWER(TRIM(address_line)) = LOWER(?) 
             OR (pincode = ? AND pincode != '' AND LOWER(TRIM(street_locality)) = LOWER(?) AND LOWER(TRIM(house_flat)) = LOWER(?))
           )
           LIMIT 1`,
          [
            userId,
            cleanShippingAddr,
            pin,
            (req.body.shipping_parts?.street_locality || '').trim(),
            (req.body.shipping_parts?.house_flat || '').trim()
          ]
        );

        if (!existingAddr || existingAddr.length === 0) {
          const [countRows] = await connection.query('SELECT COUNT(*) as cnt FROM customer_addresses WHERE user_id = ?', [userId]);
          const isFirstAddress = countRows[0].cnt === 0 ? 1 : 0;

          const partsObj = req.body.shipping_parts || {};
          let house = (partsObj.house_flat || '').trim();
          let street = (partsObj.street_locality || '').trim();
          let city = (partsObj.city || '').trim();
          let state = (partsObj.state || '').trim();

          if (!street) {
            const splitParts = cleanShippingAddr.split(',').map((s) => s.trim());
            house = splitParts.length > 2 ? splitParts[0] : '';
            street = splitParts.length > 2 ? splitParts[1] : (splitParts[0] || '');
            city = splitParts.length > 3 ? splitParts[2] : (splitParts[1] || 'Bengaluru');
            state = splitParts.length > 4 ? splitParts[3].replace(/-\s*\d{6}/, '').trim() : 'Karnataka';
          }

          const [insResult] = await connection.query(
            `INSERT INTO customer_addresses 
             (user_id, label, recipient_name, phone, address_line, house_flat, street_locality, city, state, pincode, is_default)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              userId,
              'Delivery Address',
              customer_name || 'Customer',
              customer_phone || '',
              cleanShippingAddr,
              house,
              street,
              city || 'Bengaluru',
              state || 'Karnataka',
              pin,
              isFirstAddress
            ]
          );

          const [savedRow] = await connection.query('SELECT * FROM customer_addresses WHERE id = ?', [insResult.insertId]);
          if (savedRow.length > 0) {
            autoSavedAddress = savedRow[0];
          }
        } else {
          autoSavedAddress = existingAddr[0];
        }
      } catch (addrErr) {
        console.warn('Could not auto-save address to customer_addresses:', addrErr.message);
      }
    }

    // Insert order items
    for (const vItem of validatedItems) {
      await connection.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, grind_type, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderId, vItem.product_id, vItem.product_name, vItem.quantity, vItem.unit_price, vItem.grind_type, vItem.subtotal]
      );
    }

    // Increment coupon usage if promo_code provided
    const promoCode = req.body.promo_code;
    if (promoCode) {
      await connection.query('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?', [promoCode.trim().toUpperCase()]);
    }

    // Auto-initialize Amazon/Flipkart grade live tracking & loyalty
    const randomTrk = 'TRK-IN-' + Math.floor(10000000 + Math.random() * 90000000);
    const estDate = new Date();
    estDate.setDate(estDate.getDate() + 3);
    const estDateStr = estDate.toISOString().split('T')[0];
    const isSub = req.body.is_subscription ? 1 : 0;
    const beanCoinsUsed = parseInt(req.body.bean_coins_used, 10) || 0;

    await connection.query(
      `UPDATE orders SET 
        tracking_number = ?, 
        courier_name = ?, 
        order_step = 1, 
        estimated_delivery = ?, 
        is_subscription = ?, 
        bean_coins_used = ? 
       WHERE id = ?`,
      [randomTrk, 'BlueDart Express', estDateStr, isSub, beanCoinsUsed, orderId]
    );

    // Update Bean Coins loyalty wallet if customer is signed in
    if (userId) {
      if (beanCoinsUsed > 0) {
        await connection.query(
          `UPDATE bean_coins_wallets SET 
            balance = GREATEST(0, balance - ?), 
            total_spent = total_spent + ? 
           WHERE user_id = ?`,
          [beanCoinsUsed, beanCoinsUsed, userId]
        );
      }
      /*
      // Bean Coins award on order (temporarily commented out for future use)
      await connection.query(
        `UPDATE bean_coins_wallets SET 
          balance = balance + 15, 
          total_earned = total_earned + 15 
         WHERE user_id = ?`,
        [userId]
      );
      */
    }

    await connection.commit();

    await logSecurityEvent(
      'VERIFIED_ORDER_PLACED',
      'INFO',
      clientIp,
      normalizedEmail,
      `Order ${orderNumber} (ID: ${orderId}) placed successfully. Verification: ${verificationMethod}. Total: ₹${finalOrderTotal}`
    );

    const [createdOrder] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    const [orderItemsList] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [orderId]);

    // Dispatch automatic Email and SMS confirmation/processing alert
    let initialNotification = null;
    try {
      initialNotification = await notifyCustomerOrderEvent(
        { ...createdOrder[0], items: orderItemsList },
        'PROCESSING'
      );
    } catch (notifErr) {
      console.warn('⚠️ Order placed but notification dispatch had warning:', notifErr.message);
    }

    res.status(201).json({
      success: true,
      message: 'Order placed successfully. Confirmation sent via Email & SMS!',
      data: {
        ...createdOrder[0],
        items: orderItemsList
      },
      saved_address: autoSavedAddress,
      notifications: initialNotification
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating order:', error);
    res.status(500).json({ success: false, message: 'Server error processing order', error: error.message });
  } finally {
    connection.release();
  }
};

// Get all orders (for admin dashboard)
exports.getOrders = async (req, res) => {
  try {
    const { status, search } = req.query;
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params = [];

    if (status && status !== 'All') {
      query += ' AND status = ?';
      params.push(status);
    }

    if (search) {
      query += ' AND (order_number LIKE ? OR customer_name LIKE ? OR customer_email LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    query += ' ORDER BY id DESC';

    const [orders] = await pool.query(query, params);

    // Fetch items for all returned orders
    for (const order of orders) {
      const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
      order.items = items;
    }

    res.json({ success: true, count: orders.length, data: orders });
  } catch (error) {
    console.error('Error retrieving orders:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving orders', error: error.message });
  }
};

// Get single order by ID or order number
exports.getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const isOrderNumber = isNaN(id);
    const query = isOrderNumber ? 'SELECT * FROM orders WHERE order_number = ?' : 'SELECT * FROM orders WHERE id = ?';

    const [orders] = await pool.query(query, [id]);
    if (orders.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const order = orders[0];
    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    order.items = items;

    // Attach sent notification logs (Email & SMS)
    const [notifications] = await pool.query('SELECT * FROM order_notifications WHERE order_id = ? ORDER BY id DESC', [order.id]);
    order.notifications = notifications;

    res.json({ success: true, data: order });
  } catch (error) {
    console.error('Error retrieving order:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving order', error: error.message });
  }
};

// Update order status and automatically dispatch Email and SMS notifications
exports.updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const [existing] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Sync order_step with status
    let orderStepUpdate = null;
    if (status === 'Processing') orderStepUpdate = 2;
    else if (status === 'Shipped') orderStepUpdate = 3;
    else if (status === 'Delivered') orderStepUpdate = 5;

    if (orderStepUpdate) {
      await pool.query('UPDATE orders SET status = ?, order_step = ? WHERE id = ?', [status, orderStepUpdate, id]);
    } else {
      await pool.query('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
    }

    const [updated] = await pool.query('SELECT * FROM orders WHERE id = ?', [id]);
    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [id]);
    updated[0].items = items;

    // Trigger Email & SMS notification when status is Processing, Shipped, or Delivered
    let notificationResult = null;
    if (['Processing', 'Shipped', 'Delivered'].includes(status)) {
      notificationResult = await notifyCustomerOrderEvent(updated[0], status.toUpperCase());
    }

    // Include updated notification logs
    const [notifications] = await pool.query('SELECT * FROM order_notifications WHERE order_id = ? ORDER BY id DESC', [id]);
    updated[0].notifications = notifications;

    res.json({
      success: true,
      message: `Order #${updated[0].order_number} marked as ${status}. Email and SMS dispatched to customer!`,
      data: updated[0],
      notifications: notificationResult
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ success: false, message: 'Server error updating order status', error: error.message });
  }
};

// Get Notification History for an Order
exports.getOrderNotifications = async (req, res) => {
  try {
    const { id } = req.params;
    const notifications = await getOrderNotificationHistory(id);
    res.json({ success: true, count: notifications.length, data: notifications });
  } catch (error) {
    console.error('Error fetching order notifications:', error);
    res.status(500).json({ success: false, message: 'Server error fetching notification history', error: error.message });
  }
};

