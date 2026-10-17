const { pool } = require('../config/db');

exports.getDashboardStats = async (req, res) => {
  try {
    // Total products & low stock
    const [productStats] = await pool.query(`
      SELECT 
        COUNT(*) AS total_products,
        SUM(CASE WHEN stock_quantity = 0 THEN 1 ELSE 0 END) AS out_of_stock,
        SUM(CASE WHEN stock_quantity > 0 AND stock_quantity <= 10 THEN 1 ELSE 0 END) AS low_stock,
        SUM(stock_quantity) AS total_inventory_units
      FROM products
    `);

    // Orders stats
    const [orderStats] = await pool.query(`
      SELECT 
        COUNT(*) AS total_orders,
        COALESCE(SUM(total_amount), 0) AS total_revenue,
        SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending_orders,
        SUM(CASE WHEN status = 'Processing' THEN 1 ELSE 0 END) AS processing_orders,
        SUM(CASE WHEN status = 'Shipped' THEN 1 ELSE 0 END) AS shipped_orders,
        SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END) AS delivered_orders
      FROM orders
    `);

    // Recent 5 orders
    const [recentOrders] = await pool.query(`
      SELECT id, order_number, customer_name, total_amount, status, created_at 
      FROM orders 
      ORDER BY id DESC 
      LIMIT 5
    `);

    // Low stock items list (stock <= 10)
    const [lowStockItems] = await pool.query(`
      SELECT id, name, origin, roast_level, stock_quantity, price, image_url 
      FROM products 
      WHERE stock_quantity <= 10 
      ORDER BY stock_quantity ASC
    `);

    res.json({
      success: true,
      data: {
        products: productStats[0],
        orders: orderStats[0],
        recentOrders,
        lowStockItems
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving dashboard stats', error: error.message });
  }
};
