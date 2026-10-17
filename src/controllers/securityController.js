const { pool } = require('../config/db');

// Get Security & Bot Shield Dashboard Stats (Admin only)
exports.getSecurityDashboard = async (req, res) => {
  try {
    // 1. Total events breakdown
    const [counts] = await pool.query(`
      SELECT 
        COUNT(*) as total_events,
        SUM(CASE WHEN severity = 'BLOCKED_ATTACK' THEN 1 ELSE 0 END) as blocked_attacks,
        SUM(CASE WHEN event_type = 'BOT_HONEYPOT_TRIGGERED' THEN 1 ELSE 0 END) as honeypot_blocks,
        SUM(CASE WHEN event_type = 'DISPOSABLE_EMAIL_BLOCKED' THEN 1 ELSE 0 END) as disposable_email_blocks,
        SUM(CASE WHEN event_type = 'BOT_VELOCITY_TRIGGERED' THEN 1 ELSE 0 END) as velocity_blocks,
        SUM(CASE WHEN event_type = 'UNVERIFIED_ORDER_BLOCKED' THEN 1 ELSE 0 END) as unverified_order_blocks,
        SUM(CASE WHEN event_type = 'VERIFIED_ORDER_PLACED' THEN 1 ELSE 0 END) as verified_orders
      FROM security_audit_logs
    `);

    // 2. Total registered verified users
    const [userStats] = await pool.query(`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN is_email_verified = 1 THEN 1 ELSE 0 END) as verified_users
      FROM users
    `);

    // 3. Recent 40 audit events
    const [recentLogs] = await pool.query(`
      SELECT * FROM security_audit_logs 
      ORDER BY id DESC LIMIT 40
    `);

    // 4. Verification OTP stats
    const [otpStats] = await pool.query(`
      SELECT 
        COUNT(*) as total_otps,
        SUM(CASE WHEN is_used = 1 THEN 1 ELSE 0 END) as used_otps
      FROM email_verifications
    `);

    res.json({
      success: true,
      data: {
        summary: {
          blocked_attacks: counts[0].blocked_attacks || 0,
          honeypot_blocks: counts[0].honeypot_blocks || 0,
          disposable_email_blocks: counts[0].disposable_email_blocks || 0,
          velocity_blocks: counts[0].velocity_blocks || 0,
          unverified_order_blocks: counts[0].unverified_order_blocks || 0,
          verified_orders: counts[0].verified_orders || 0,
          total_users: userStats[0].total_users || 0,
          verified_users: userStats[0].verified_users || 0,
          total_otps_dispatched: otpStats[0].total_otps || 0,
          successful_verifications: otpStats[0].used_otps || 0
        },
        shields: [
          { name: 'Email OTP Verification', status: 'ACTIVE', description: 'Requires 6-digit confirmation code before order creation' },
          { name: 'Disposable Email Blocker', status: 'ACTIVE', description: 'Filters 100+ burner and temporary mail domains' },
          { name: 'Honeypot Trap Matrix', status: 'ACTIVE', description: 'Invisible input fields trap and block automated form crawlers' },
          { name: 'Velocity Anti-Bot Check', status: 'ACTIVE', description: 'Blocks non-human submissions under 1.2s threshold' },
          { name: 'Sliding Window Rate Limiter', status: 'ACTIVE', description: 'Restricts rapid request flooding per IP network' },
          { name: 'Inventory Drain Guard', status: 'ACTIVE', description: 'Caps bulk line-item quantities to protect roastery stock' }
        ],
        logs: recentLogs
      }
    });
  } catch (error) {
    console.error('Error fetching security dashboard:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving security logs', error: error.message });
  }
};
