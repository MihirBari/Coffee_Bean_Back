const { pool } = require('../config/db');

// Helper to convert key-value rows to an object
const formatSettings = (rows) => {
  const result = {};

  rows.forEach((row) => {
    const key = row.setting_key;
    const val = row.setting_value;
    if (key === 'delivery_charge' || key === 'free_delivery_min_order') {
      result[key] = parseFloat(val) || 0;
    } else if (key === 'free_delivery_item_threshold' || key === 'return_window_days') {
      result[key] = parseInt(val, 10) || 0;
    } else {
      result[key] = val;
    }
  });

  return result;
};

// GET /api/settings
exports.getSettings = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM store_settings');
    const settings = formatSettings(rows);
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving settings', error: error.message });
  }
};

// PUT /api/settings (Admin protected)
exports.updateSettings = async (req, res) => {
  try {
    const updates = req.body; // e.g. { delivery_charge: 55, free_delivery_item_threshold: 2, free_delivery_min_order: 500, ... }

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid settings payload' });
    }

    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined && val !== null) {
        await pool.query(
          `INSERT INTO store_settings (setting_key, setting_value) 
           VALUES (?, ?) 
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [key, String(val)]
        );
      }
    }

    const [rows] = await pool.query('SELECT setting_key, setting_value FROM store_settings');
    const settings = formatSettings(rows);

    res.json({
      success: true,
      message: 'Store settings updated successfully',
      data: settings
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ success: false, message: 'Server error updating settings', error: error.message });
  }
};
