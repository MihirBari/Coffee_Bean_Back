const { pool } = require('../config/db');

// Track page view event
exports.trackPageView = async (req, res) => {
  try {
    const { page_path, page_title, visitor_id, referrer } = req.body;
    if (!page_path || !visitor_id) {
      return res.status(400).json({ success: false, message: 'page_path and visitor_id are required' });
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    const userId = req.user ? req.user.id : null;

    await pool.query(
      `INSERT INTO traffic_logs (page_path, page_title, visitor_id, user_id, referrer, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [page_path, page_title || page_path, visitor_id, userId, referrer || '', userAgent, ip]
    );

    res.status(201).json({ success: true, message: 'Page view recorded' });
  } catch (error) {
    console.error('Error tracking page view:', error);
    res.status(500).json({ success: false, message: 'Error tracking page view', error: error.message });
  }
};

// Track product interaction event (view, add_to_cart, wishlist)
exports.trackProductEvent = async (req, res) => {
  try {
    const { product_id, event_type, visitor_id } = req.body;
    if (!product_id || !event_type || !visitor_id) {
      return res.status(400).json({ success: false, message: 'product_id, event_type, and visitor_id are required' });
    }

    const userId = req.user ? req.user.id : null;

    await pool.query(
      `INSERT INTO product_events (product_id, event_type, visitor_id, user_id)
       VALUES (?, ?, ?, ?)`,
      [product_id, event_type, visitor_id, userId]
    );

    res.status(201).json({ success: true, message: 'Product event recorded' });
  } catch (error) {
    console.error('Error tracking product event:', error);
    res.status(500).json({ success: false, message: 'Error tracking product event', error: error.message });
  }
};

// Get comprehensive analytics dashboard data
exports.getAnalyticsDashboard = async (req, res) => {
  try {
    const { timeRange = '7d' } = req.query;
    
    // Determine time range boundary
    const now = new Date();
    let startDate;
    let daysInRange = 7;

    if (timeRange === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      daysInRange = 1;
    } else if (timeRange === '7d') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      daysInRange = 7;
    } else if (timeRange === '30d') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      daysInRange = 30;
    } else { // 'all'
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      daysInRange = 90;
    }

    const startDateStr = startDate.toISOString().slice(0, 19).replace('T', ' ');
    const todayStartStr = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
      .toISOString().slice(0, 19).replace('T', ' ');

    // 1. KPI Aggregates for the selected period
    const [trafficKpis] = await pool.query(
      `SELECT 
         COUNT(*) AS total_views,
         COUNT(DISTINCT visitor_id) AS unique_visitors
       FROM traffic_logs
       WHERE created_at >= ?`,
      [startDateStr]
    );

    const [orderKpis] = await pool.query(
      `SELECT 
         COUNT(*) AS total_orders,
         COALESCE(SUM(total_amount), 0) AS gross_revenue
       FROM orders
       WHERE created_at >= ?`,
      [startDateStr]
    );

    // Today's live stats
    const [todayTraffic] = await pool.query(
      `SELECT 
         COUNT(*) AS today_views,
         COUNT(DISTINCT visitor_id) AS today_visitors
       FROM traffic_logs
       WHERE created_at >= ?`,
      [todayStartStr]
    );

    const [todayOrders] = await pool.query(
      `SELECT 
         COUNT(*) AS today_orders,
         COALESCE(SUM(total_amount), 0) AS today_revenue
       FROM orders
       WHERE created_at >= ?`,
      [todayStartStr]
    );

    const totalViews = trafficKpis[0]?.total_views || 0;
    const uniqueVisitors = trafficKpis[0]?.unique_visitors || 0;
    const totalOrders = orderKpis[0]?.total_orders || 0;
    const grossRevenue = parseFloat(orderKpis[0]?.gross_revenue || 0);
    const conversionRate = uniqueVisitors > 0 ? ((totalOrders / uniqueVisitors) * 100).toFixed(1) : 0;
    const avgOrderValue = totalOrders > 0 ? (grossRevenue / totalOrders).toFixed(2) : 0;

    // 2. "Which page was accessed more" - Ranked Page Traffic Breakdown
    const [pageBreakdown] = await pool.query(
      `SELECT 
         page_path, 
         page_title, 
         COUNT(*) AS total_views, 
         COUNT(DISTINCT visitor_id) AS unique_visitors
       FROM traffic_logs
       WHERE created_at >= ?
       GROUP BY page_path, page_title
       ORDER BY total_views DESC`,
      [startDateStr]
    );

    const formattedPages = pageBreakdown.map((page, idx) => ({
      rank: idx + 1,
      path: page.page_path,
      title: page.page_title,
      views: page.total_views,
      uniqueVisitors: page.unique_visitors,
      percentage: totalViews > 0 ? Math.round((page.total_views / totalViews) * 100) : 0
    }));

    // 3. "Which product were bought more" - Ranked Product Sales Performance & Conversion
    const [productSalesRows] = await pool.query(
      `SELECT 
         p.id AS product_id,
         p.name AS product_name,
         p.image_url,
         p.roast_level,
         p.stock_quantity,
         p.price,
         COALESCE(SUM(oi.quantity), 0) AS units_sold,
         COALESCE(SUM(oi.subtotal), 0) AS total_revenue,
         COUNT(DISTINCT oi.order_id) AS order_count
       FROM products p
       LEFT JOIN order_items oi ON oi.product_id = p.id
       LEFT JOIN orders o ON oi.order_id = o.id AND o.created_at >= ?
       GROUP BY p.id, p.name, p.image_url, p.roast_level, p.stock_quantity, p.price
       ORDER BY units_sold DESC, total_revenue DESC`,
      [startDateStr]
    );

    // Fetch product view events in this period to measure product conversion rate
    const [prodViewRows] = await pool.query(
      `SELECT product_id, COUNT(*) AS view_count
       FROM product_events
       WHERE event_type = 'view' AND created_at >= ?
       GROUP BY product_id`,
      [startDateStr]
    );

    const viewCountMap = {};
    prodViewRows.forEach(v => { viewCountMap[v.product_id] = v.view_count; });

    let totalUnitsSold = 0;
    productSalesRows.forEach(r => { totalUnitsSold += parseInt(r.units_sold || 0, 10); });

    const productsRanked = productSalesRows.map((p, idx) => {
      const units = parseInt(p.units_sold || 0, 10);
      const views = viewCountMap[p.product_id] || Math.max(units * 3, 5); // baseline estimation if fresh
      const revenue = parseFloat(p.total_revenue || 0);
      const convRate = views > 0 ? ((units / views) * 100).toFixed(1) : 0;
      const shareOfSales = totalUnitsSold > 0 ? Math.round((units / totalUnitsSold) * 100) : 0;

      return {
        rank: idx + 1,
        id: p.product_id,
        name: p.product_name,
        image_url: p.image_url,
        roast_level: p.roast_level,
        stock_quantity: p.stock_quantity,
        price: parseFloat(p.price),
        units_sold: units,
        total_revenue: revenue,
        order_count: p.order_count || 0,
        views: views,
        conversion_rate: parseFloat(convRate),
        share_of_sales: shareOfSales
      };
    });

    // Grind Types popularity breakdown
    const [grindRows] = await pool.query(
      `SELECT 
         oi.grind_type, 
         COALESCE(SUM(oi.quantity), 0) AS units_sold 
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.created_at >= ?
       GROUP BY oi.grind_type
       ORDER BY units_sold DESC`,
      [startDateStr]
    );

    const grindPreferences = grindRows.map(g => ({
      grind_type: g.grind_type || 'Whole Bean',
      units_sold: parseInt(g.units_sold || 0, 10),
      percentage: totalUnitsSold > 0 ? Math.round((parseInt(g.units_sold || 0, 10) / totalUnitsSold) * 100) : 0
    }));

    // 4. Time Trends & "How many time a day"
    // Daily breakdown for the selected range
    const [dailyTrafficRows] = await pool.query(
      `SELECT 
         DATE(created_at) AS date_key,
         COUNT(*) AS views,
         COUNT(DISTINCT visitor_id) AS visitors
       FROM traffic_logs
       WHERE created_at >= ?
       GROUP BY DATE(created_at)
       ORDER BY date_key ASC`,
      [startDateStr]
    );

    const [dailyOrderRows] = await pool.query(
      `SELECT 
         DATE(created_at) AS date_key,
         COUNT(*) AS orders,
         COALESCE(SUM(total_amount), 0) AS revenue
       FROM orders
       WHERE created_at >= ?
       GROUP BY DATE(created_at)
       ORDER BY date_key ASC`,
      [startDateStr]
    );

    const dailyTrafficMap = {};
    dailyTrafficRows.forEach(r => {
      const key = r.date_key instanceof Date ? r.date_key.toISOString().slice(0, 10) : String(r.date_key);
      dailyTrafficMap[key] = { views: r.views, visitors: r.visitors };
    });

    const dailyOrderMap = {};
    dailyOrderRows.forEach(r => {
      const key = r.date_key instanceof Date ? r.date_key.toISOString().slice(0, 10) : String(r.date_key);
      dailyOrderMap[key] = { orders: r.orders, revenue: parseFloat(r.revenue || 0) };
    });

    // Generate full daily series for the days in range so there are no empty gaps
    const dailyTrends = [];
    const loopDays = timeRange === 'today' ? 1 : (timeRange === '7d' ? 7 : (timeRange === '30d' ? 30 : 14));
    for (let i = loopDays - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateKey = d.toISOString().slice(0, 10);
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const t = dailyTrafficMap[dateKey] || { views: 0, visitors: 0 };
      const o = dailyOrderMap[dateKey] || { orders: 0, revenue: 0 };

      dailyTrends.push({
        date: dateKey,
        label: i === 0 ? 'Today' : dayLabel,
        views: t.views,
        visitors: t.visitors,
        orders: o.orders,
        revenue: o.revenue
      });
    }

    // Hourly Breakdown (24 hours) for traffic and orders
    const [hourlyTrafficRows] = await pool.query(
      `SELECT 
         HOUR(created_at) AS hour_num,
         COUNT(*) AS views
       FROM traffic_logs
       WHERE created_at >= ?
       GROUP BY HOUR(created_at)
       ORDER BY hour_num ASC`,
      [startDateStr]
    );

    const [hourlyOrderRows] = await pool.query(
      `SELECT 
         HOUR(created_at) AS hour_num,
         COUNT(*) AS orders
       FROM orders
       WHERE created_at >= ?
       GROUP BY HOUR(created_at)
       ORDER BY hour_num ASC`,
      [startDateStr]
    );

    const hourlyTrafficMap = {};
    hourlyTrafficRows.forEach(r => { hourlyTrafficMap[r.hour_num] = r.views; });
    const hourlyOrderMap = {};
    hourlyOrderRows.forEach(r => { hourlyOrderMap[r.hour_num] = r.orders; });

    let peakHour = 9;
    let maxHourlyViews = 0;

    const hourlyDistribution = [];
    for (let h = 0; h < 24; h++) {
      const v = hourlyTrafficMap[h] || 0;
      const o = hourlyOrderMap[h] || 0;
      if (v > maxHourlyViews) {
        maxHourlyViews = v;
        peakHour = h;
      }
      const ampm = h >= 12 ? 'PM' : 'AM';
      const displayH = h % 12 === 0 ? 12 : h % 12;
      hourlyDistribution.push({
        hour: h,
        label: `${displayH} ${ampm}`,
        views: v,
        orders: o
      });
    }

    const peakHourLabel = `${peakHour % 12 === 0 ? 12 : peakHour % 12} ${peakHour >= 12 ? 'PM' : 'AM'} - ${(peakHour + 1) % 12 === 0 ? 12 : (peakHour + 1) % 12} ${peakHour + 1 >= 12 ? 'PM' : 'AM'}`;

    // 5. "Plan how should I proceed forward with stocks" - Stock Forecasting & Planning Intelligence
    // Calculate stock burn rates and forecasting for all catalog products
    const [allCatalogProducts] = await pool.query('SELECT * FROM products ORDER BY stock_quantity ASC');
    
    // Units sold in last 14 days for burn rate calculation
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const [recentSales] = await pool.query(
      `SELECT 
         oi.product_id,
         COALESCE(SUM(oi.quantity), 0) AS units_sold_14d
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.created_at >= ?
       GROUP BY oi.product_id`,
      [fourteenDaysAgo]
    );

    const sales14dMap = {};
    recentSales.forEach(r => { sales14dMap[r.product_id] = parseInt(r.units_sold_14d || 0, 10); });

    const stockPlanning = allCatalogProducts.map(prod => {
      const currentStock = prod.stock_quantity;
      const sold14d = sales14dMap[prod.id] || 0;
      // Daily burn rate (units per day based on 14-day history)
      const dailyBurn = +(sold14d / 14).toFixed(2);

      let daysRemaining;
      let status;
      let statusLabel;
      let statusColor;
      let suggestedRestock;
      let actionAdvice;
      let priority;

      if (currentStock === 0) {
        daysRemaining = 0;
        status = 'OUT_OF_STOCK';
        statusLabel = 'Out of Stock';
        statusColor = 'red';
        suggestedRestock = Math.max(35, Math.ceil(dailyBurn * 25));
        actionAdvice = '🚨 Completely Out of Stock! Roast priority batch immediately to capture lost sales.';
        priority = 1;
      } else if (currentStock <= 10) {
        daysRemaining = dailyBurn > 0 ? +(currentStock / dailyBurn).toFixed(1) : '< 10 Bags';
        status = 'CRITICAL';
        statusLabel = 'Critical Stock (≤ 10 Bags)';
        statusColor = 'red';
        suggestedRestock = Math.max(25, 45 - currentStock);
        actionAdvice = `🚨 Critical shelf quantity (${currentStock} bags remaining). Immediate roast batch of ${suggestedRestock} bags recommended.`;
        priority = 2;
      } else if (dailyBurn > 0 && (currentStock / dailyBurn) <= 7) {
        daysRemaining = +(currentStock / dailyBurn).toFixed(1);
        status = 'CRITICAL';
        statusLabel = 'Depleting Fast (< 7 Days)';
        statusColor = 'red';
        suggestedRestock = Math.max(25, Math.ceil(dailyBurn * 21) - currentStock);
        actionAdvice = `🔥 Rapid turnover (${dailyBurn} bags/day). Depletes in ~${daysRemaining} days! Schedule roast of ${suggestedRestock} bags urgently.`;
        priority = 2;
      } else if (dailyBurn > 0 && (currentStock / dailyBurn) <= 15) {
        daysRemaining = +(currentStock / dailyBurn).toFixed(1);
        status = 'RESTOCK_SOON';
        statusLabel = 'Restock Soon';
        statusColor = 'amber';
        suggestedRestock = Math.max(15, Math.ceil(dailyBurn * 21) - currentStock);
        actionAdvice = `⚠️ Stock running down (~${daysRemaining} days left). Schedule batch of ${suggestedRestock} bags within this week.`;
        priority = 3;
      } else if (currentStock > 45 && dailyBurn < 0.4) {
        daysRemaining = dailyBurn > 0 ? +(currentStock / dailyBurn).toFixed(1) : '30+';
        status = 'OVERSTOCKED';
        statusLabel = 'High Stock / Slow Turnover';
        statusColor = 'blue';
        suggestedRestock = 0;
        actionAdvice = `📦 Overstocked (${currentStock} bags, slow burn of ${dailyBurn} bags/day). Recommend 10-15% promotional discount or tasting bundle.`;
        priority = 5;
      } else {
        daysRemaining = dailyBurn > 0 ? +(currentStock / dailyBurn).toFixed(1) : '30+';
        status = 'OPTIMAL';
        statusLabel = 'Healthy Stock';
        statusColor = 'emerald';
        suggestedRestock = 0;
        actionAdvice = `✅ Healthy inventory level (${currentStock} bags). Sustainable burn rate (${dailyBurn} bags/day). No restock needed now.`;
        priority = 4;
      }

      return {
        id: prod.id,
        name: prod.name,
        image_url: prod.image_url,
        roast_level: prod.roast_level,
        origin: prod.origin,
        price: parseFloat(prod.price),
        stock_quantity: currentStock,
        sold_last_14d: sold14d,
        daily_burn_rate: dailyBurn,
        days_remaining: daysRemaining === 999 ? '30+' : daysRemaining,
        days_remaining_num: daysRemaining,
        status,
        statusLabel,
        statusColor,
        suggested_restock: suggestedRestock,
        action_advice: actionAdvice,
        priority
      };
    });

    // Sort stock planning by urgency priority (critical first)
    stockPlanning.sort((a, b) => a.priority - b.priority || a.days_remaining_num - b.days_remaining_num);

    // Summary count of stock statuses
    const stockSummary = {
      criticalCount: stockPlanning.filter(p => p.status === 'CRITICAL' || p.status === 'OUT_OF_STOCK').length,
      restockSoonCount: stockPlanning.filter(p => p.status === 'RESTOCK_SOON').length,
      optimalCount: stockPlanning.filter(p => p.status === 'OPTIMAL').length,
      overstockedCount: stockPlanning.filter(p => p.status === 'OVERSTOCKED' || p.status === 'LOW_SLOW').length,
      totalCatalogProducts: stockPlanning.length
    };

    res.json({
      success: true,
      timeRange,
      kpis: {
        totalViews,
        uniqueVisitors,
        totalOrders,
        grossRevenue,
        conversionRate,
        avgOrderValue,
        todayViews: todayTraffic[0]?.today_views || 0,
        todayVisitors: todayTraffic[0]?.today_visitors || 0,
        todayOrders: todayOrders[0]?.today_orders || 0,
        todayRevenue: parseFloat(todayOrders[0]?.today_revenue || 0),
        peakHourWindow: peakHourLabel
      },
      pageTraffic: formattedPages,
      productSales: {
        ranked: productsRanked,
        totalUnitsSold,
        grindPreferences,
        slowMovers: productsRanked.slice(-3).reverse()
      },
      dailyTrends,
      hourlyDistribution,
      stockPlanning: {
        summary: stockSummary,
        products: stockPlanning
      }
    });

  } catch (error) {
    console.error('Error fetching analytics dashboard:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving analytics data', error: error.message });
  }
};
