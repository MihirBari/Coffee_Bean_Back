const { pool } = require('../config/db');
const { sendOrderStatusEmail } = require('./emailService');
const { sendOrderStatusSMS } = require('./smsService');

/**
 * Dispatches both Email and SMS notifications for order lifecycle events:
 * - 'PROCESSING' (when order is accepted and in roastery preparation)
 * - 'SHIPPED'    (when order is dispatched with carrier and tracking AWB)
 * - 'DELIVERED'  (when order reaches doorstep)
 * 
 * @param {Object|number} orderOrId - Full order object or order ID
 * @param {string} event - 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'ORDER_PLACED'
 * @param {Object} [extraData] - Optional overrides (e.g. tracking_number, courier_name)
 * @returns {Promise<{email: Object, sms: Object}>}
 */
async function notifyCustomerOrderEvent(orderOrId, event, extraData = {}) {
  let order = orderOrId;
  let items = [];

  try {
    // If orderOrId is an ID or lacks items, fetch fresh from DB
    if (typeof orderOrId === 'number' || typeof orderOrId === 'string' || !order.items) {
      const orderId = typeof orderOrId === 'object' ? orderOrId.id : orderOrId;
      const [orderRows] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId]);
      if (orderRows.length === 0) {
        console.error(`⚠️ [Notification] Order ID ${orderId} not found`);
        return { email: { success: false, reason: 'ORDER_NOT_FOUND' }, sms: { success: false, reason: 'ORDER_NOT_FOUND' } };
      }
      order = { ...orderRows[0], ...extraData };
      const [itemRows] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
      items = itemRows;
    } else {
      order = { ...order, ...extraData };
      items = order.items || [];
    }

    const normEvent = event.toUpperCase();
    console.log(`\n📣 [NOTIFY CUSTOMER] Dispatching Mail & SMS for Order #${order.order_number} (Event: ${normEvent})`);

    // 1. Send Email Notification
    let emailResult = { success: false };
    try {
      emailResult = await sendOrderStatusEmail({
        order,
        items,
        event: normEvent
      });
    } catch (mailErr) {
      console.error(`⚠️ [Email Dispatch Error] #${order.order_number}:`, mailErr.message);
      emailResult = { success: false, error: mailErr.message };
    }

    // 2. Send SMS Notification
    let smsResult = { success: false };
    try {
      smsResult = await sendOrderStatusSMS({
        order,
        event: normEvent
      });
    } catch (smsErr) {
      console.error(`⚠️ [SMS Dispatch Error] #${order.order_number}:`, smsErr.message);
      smsResult = { success: false, error: smsErr.message };
    }

    return {
      order_id: order.id,
      order_number: order.order_number,
      event: normEvent,
      email: emailResult,
      sms: smsResult
    };
  } catch (err) {
    console.error(`⚠️ [Notification Orchestrator Error] Order ${orderOrId}:`, err);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Fetch notification log history for a specific order
 * @param {number} orderId 
 * @returns {Promise<Array>}
 */
async function getOrderNotificationHistory(orderId) {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM order_notifications WHERE order_id = ? ORDER BY id DESC`,
      [orderId]
    );
    return rows;
  } catch (err) {
    console.error(`Error fetching notification history for order ${orderId}:`, err);
    return [];
  }
}

module.exports = {
  notifyCustomerOrderEvent,
  getOrderNotificationHistory
};
