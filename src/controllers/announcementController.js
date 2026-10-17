const { pool } = require('../config/db');

// 1. Get active announcement (Public - for Top Banner)
exports.getActiveAnnouncement = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM announcements WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
    );
    res.json({
      success: true,
      data: rows.length > 0 ? rows[0] : null
    });
  } catch (error) {
    console.error('Error fetching active announcement:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving announcement', error: error.message });
  }
};

// 2. Get all announcements (Admin only)
exports.getAllAnnouncements = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM announcements ORDER BY id DESC');
    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error('Error fetching announcements:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving announcements', error: error.message });
  }
};

// 3. Create or save announcement (Admin only)
exports.createAnnouncement = async (req, res) => {
  try {
    const { 
      message, 
      banner_type = 'marquee', 
      coupon_code = '', 
      link_text = '', 
      link_url = '', 
      theme = 'sceptre-red', 
      is_active = 1 
    } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Announcement message is required' });
    }

    // If setting active, deactivate other announcements so only 1 is active at a time
    if (is_active) {
      await pool.query('UPDATE announcements SET is_active = 0');
    }

    const [result] = await pool.query(
      `INSERT INTO announcements (message, banner_type, coupon_code, link_text, link_url, theme, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        message.trim(),
        banner_type || 'marquee',
        (coupon_code || '').trim().toUpperCase(),
        link_text || '',
        link_url || '',
        theme || 'sceptre-red',
        is_active ? 1 : 0
      ]
    );

    const [created] = await pool.query('SELECT * FROM announcements WHERE id = ?', [result.insertId]);
    res.status(201).json({
      success: true,
      message: 'Announcement banner published successfully!',
      data: created[0]
    });
  } catch (error) {
    console.error('Error creating announcement:', error);
    res.status(500).json({ success: false, message: 'Server error creating announcement', error: error.message });
  }
};

// 4. Update announcement (Admin only)
exports.updateAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      message, 
      banner_type, 
      coupon_code, 
      link_text, 
      link_url, 
      theme, 
      is_active 
    } = req.body;

    const [existing] = await pool.query('SELECT * FROM announcements WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }

    if (is_active) {
      await pool.query('UPDATE announcements SET is_active = 0 WHERE id != ?', [id]);
    }

    await pool.query(
      `UPDATE announcements SET 
         message = ?,
         banner_type = ?,
         coupon_code = ?,
         link_text = ?,
         link_url = ?,
         theme = ?,
         is_active = ?
       WHERE id = ?`,
      [
        message !== undefined ? message.trim() : existing[0].message,
        banner_type !== undefined ? banner_type : existing[0].banner_type,
        coupon_code !== undefined ? coupon_code.trim().toUpperCase() : existing[0].coupon_code,
        link_text !== undefined ? link_text : existing[0].link_text,
        link_url !== undefined ? link_url : existing[0].link_url,
        theme !== undefined ? theme : existing[0].theme,
        is_active !== undefined ? (is_active ? 1 : 0) : existing[0].is_active,
        id
      ]
    );

    const [updated] = await pool.query('SELECT * FROM announcements WHERE id = ?', [id]);
    res.json({
      success: true,
      message: 'Announcement banner updated successfully!',
      data: updated[0]
    });
  } catch (error) {
    console.error('Error updating announcement:', error);
    res.status(500).json({ success: false, message: 'Server error updating announcement', error: error.message });
  }
};

// 5. Toggle active status (Admin only)
exports.toggleAnnouncementStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await pool.query('SELECT * FROM announcements WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }

    const newStatus = existing[0].is_active ? 0 : 1;
    if (newStatus === 1) {
      await pool.query('UPDATE announcements SET is_active = 0 WHERE id != ?', [id]);
    }

    await pool.query('UPDATE announcements SET is_active = ? WHERE id = ?', [newStatus, id]);
    const [updated] = await pool.query('SELECT * FROM announcements WHERE id = ?', [id]);

    res.json({
      success: true,
      message: `Announcement banner ${newStatus ? 'activated' : 'deactivated'}!`,
      data: updated[0]
    });
  } catch (error) {
    console.error('Error toggling announcement:', error);
    res.status(500).json({ success: false, message: 'Server error toggling announcement', error: error.message });
  }
};

// 6. Delete announcement (Admin only)
exports.deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await pool.query('SELECT * FROM announcements WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }

    await pool.query('DELETE FROM announcements WHERE id = ?', [id]);
    res.json({ success: true, message: 'Announcement deleted successfully' });
  } catch (error) {
    console.error('Error deleting announcement:', error);
    res.status(500).json({ success: false, message: 'Server error deleting announcement', error: error.message });
  }
};

// 7. Get Lightning Deal / Flash Sale (Public)
exports.getLightningDeal = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM lightning_deals ORDER BY id DESC LIMIT 1'
    );
    if (rows.length === 0) {
      return res.json({ success: true, data: null });
    }
    const deal = rows[0];
    res.json({
      success: true,
      data: deal,
      server_time: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching lightning deal:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving lightning deal', error: error.message });
  }
};

// 8. Update Lightning Deal / Flash Sale settings (Admin only)
exports.updateLightningDeal = async (req, res) => {
  try {
    const {
      title,
      badge_text,
      description,
      coupon_code,
      discount_percent,
      duration_hours,
      claimed_percent,
      items_left,
      show_in_ticker,
      is_active,
      reset_timer,
      ends_at
    } = req.body;

    const [rows] = await pool.query('SELECT * FROM lightning_deals ORDER BY id DESC LIMIT 1');
    let dealId;
    if (rows.length === 0) {
      const [ins] = await pool.query(
        `INSERT INTO lightning_deals 
         (is_active, title, badge_text, description, coupon_code, discount_percent, ends_at, duration_hours, claimed_percent, items_left, show_in_ticker)
         VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), ?, ?, ?, ?)`,
        [
          is_active !== undefined ? (is_active ? 1 : 0) : 1,
          title || '⚡ Roastery Lightning Deals',
          badge_text || 'Deal of the Day',
          description || 'Fresh roasted small-batch tins at roaster-direct pricing. Free delivery on > 2 items!',
          (coupon_code || 'FLASH20').trim().toUpperCase(),
          discount_percent !== undefined ? parseInt(discount_percent, 10) : 20,
          duration_hours !== undefined ? parseInt(duration_hours, 10) : 4,
          duration_hours !== undefined ? parseInt(duration_hours, 10) : 4,
          claimed_percent !== undefined ? parseInt(claimed_percent, 10) : 84,
          items_left !== undefined ? parseInt(items_left, 10) : 16,
          show_in_ticker !== undefined ? (show_in_ticker ? 1 : 0) : 1
        ]
      );
      dealId = ins.insertId;
    } else {
      dealId = rows[0].id;
      const current = rows[0];
      const newDuration = duration_hours !== undefined ? parseInt(duration_hours, 10) : current.duration_hours;
      
      let newEndsAt = current.ends_at;
      if (ends_at) {
        newEndsAt = new Date(ends_at);
      } else if (reset_timer) {
        const [dt] = await pool.query('SELECT DATE_ADD(NOW(), INTERVAL ? HOUR) AS reset_time', [newDuration]);
        newEndsAt = dt[0].reset_time;
      }

      await pool.query(
        `UPDATE lightning_deals SET
           title = ?,
           badge_text = ?,
           description = ?,
           coupon_code = ?,
           discount_percent = ?,
           duration_hours = ?,
           claimed_percent = ?,
           items_left = ?,
           show_in_ticker = ?,
           is_active = ?,
           ends_at = ?
         WHERE id = ?`,
        [
          title !== undefined ? title.trim() : current.title,
          badge_text !== undefined ? badge_text.trim() : current.badge_text,
          description !== undefined ? description.trim() : current.description,
          coupon_code !== undefined ? coupon_code.trim().toUpperCase() : current.coupon_code,
          discount_percent !== undefined ? parseInt(discount_percent, 10) : current.discount_percent,
          newDuration,
          claimed_percent !== undefined ? parseInt(claimed_percent, 10) : current.claimed_percent,
          items_left !== undefined ? parseInt(items_left, 10) : current.items_left,
          show_in_ticker !== undefined ? (show_in_ticker ? 1 : 0) : current.show_in_ticker,
          is_active !== undefined ? (is_active ? 1 : 0) : current.is_active,
          newEndsAt,
          dealId
        ]
      );
    }

    // Ensure coupon exists in coupons table
    const cleanCoupon = (coupon_code || 'FLASH20').trim().toUpperCase();
    const disc = discount_percent !== undefined ? parseInt(discount_percent, 10) : 20;
    await pool.query(
      `INSERT INTO coupons (code, discount_percent, description, max_uses, used_count, is_active)
       VALUES (?, ?, 'Flash Sale / Lightning Deal Discount', 500, 0, 1)
       ON DUPLICATE KEY UPDATE discount_percent = VALUES(discount_percent), is_active = 1`,
      [cleanCoupon, disc]
    );

    const [updated] = await pool.query('SELECT * FROM lightning_deals WHERE id = ?', [dealId]);
    res.json({
      success: true,
      message: 'Lightning Deal / Flash Sale banner saved successfully!',
      data: updated[0],
      server_time: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error updating lightning deal:', error);
    res.status(500).json({ success: false, message: 'Server error updating lightning deal', error: error.message });
  }
};

// 9. Instant toggle active status (Admin only)
exports.toggleLightningDeal = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM lightning_deals ORDER BY id DESC LIMIT 1');
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No lightning deal configuration found' });
    }
    const deal = rows[0];
    const newStatus = deal.is_active ? 0 : 1;
    
    if (newStatus === 1 && (!deal.ends_at || new Date(deal.ends_at) <= new Date())) {
      await pool.query(
        'UPDATE lightning_deals SET is_active = 1, ends_at = DATE_ADD(NOW(), INTERVAL ? HOUR) WHERE id = ?',
        [deal.duration_hours || 4, deal.id]
      );
    } else {
      await pool.query('UPDATE lightning_deals SET is_active = ? WHERE id = ?', [newStatus, deal.id]);
    }

    const [updated] = await pool.query('SELECT * FROM lightning_deals WHERE id = ?', [deal.id]);
    res.json({
      success: true,
      message: `Flash Sale banner ${newStatus ? 'activated and live!' : 'paused and hidden.'}`,
      data: updated[0],
      server_time: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error toggling lightning deal:', error);
    res.status(500).json({ success: false, message: 'Server error toggling lightning deal', error: error.message });
  }
};

// 10. Quick Launch Flash Sale with custom duration (Admin only)
exports.launchFlashSale = async (req, res) => {
  try {
    const { duration_hours = 4, title, badge_text, coupon_code } = req.body;
    const hours = parseInt(duration_hours, 10) || 4;

    const [rows] = await pool.query('SELECT * FROM lightning_deals ORDER BY id DESC LIMIT 1');
    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO lightning_deals 
         (is_active, title, badge_text, description, coupon_code, discount_percent, ends_at, duration_hours, claimed_percent, items_left, show_in_ticker)
         VALUES (1, ?, ?, 'Fresh roasted small-batch tins at roaster-direct pricing. Free delivery on > 2 items!', ?, 20, DATE_ADD(NOW(), INTERVAL ? HOUR), ?, 84, 16, 1)`,
        [
          title || '⚡ Roastery Lightning Deals',
          badge_text || 'Deal of the Day',
          (coupon_code || 'FLASH20').trim().toUpperCase(),
          hours,
          hours
        ]
      );
    } else {
      const deal = rows[0];
      await pool.query(
        `UPDATE lightning_deals SET 
           is_active = 1, 
           duration_hours = ?, 
           ends_at = DATE_ADD(NOW(), INTERVAL ? HOUR),
           title = COALESCE(?, title),
           badge_text = COALESCE(?, badge_text),
           coupon_code = COALESCE(?, coupon_code)
         WHERE id = ?`,
        [
          hours,
          hours,
          title ? title.trim() : null,
          badge_text ? badge_text.trim() : null,
          coupon_code ? coupon_code.trim().toUpperCase() : null,
          deal.id
        ]
      );
    }

    const [updated] = await pool.query('SELECT * FROM lightning_deals ORDER BY id DESC LIMIT 1');
    res.json({
      success: true,
      message: `Flash Sale launched successfully for ${hours} hours!`,
      data: updated[0],
      server_time: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error launching flash sale:', error);
    res.status(500).json({ success: false, message: 'Server error launching flash sale', error: error.message });
  }
};

