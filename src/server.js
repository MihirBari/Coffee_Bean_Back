const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const { pool, checkDatabaseConnection } = require('./config/db');
const { isCloudinaryConfigured } = require('./config/cloudinary');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: '*', // Allow local frontend during development
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const { globalApiLimiter } = require('./middleware/botProtection');
app.use('/api', globalApiLimiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Import routes
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const statsRoutes = require('./routes/statsRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const couponRoutes = require('./routes/couponRoutes');
const announcementRoutes = require('./routes/announcementRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const marketplaceRoutes = require('./routes/marketplaceRoutes');
const securityRoutes = require('./routes/securityRoutes');
const paymentRoutes = require('./routes/paymentRoutes');

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/payment', paymentRoutes);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 + 1 AS test');
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
      service: 'Coffee Bean Backend API'
    });
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: err.message
    });
  }
});

// Root welcome route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Coffee Bean E-Commerce REST API',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      products: '/api/products',
      orders: '/api/orders',
      stats: '/api/stats/dashboard',
      upload: '/api/upload'
    },
    version: '2.0.0'
  });
});

// Start server and verify database connection
async function startServer() {
  try {
    await checkDatabaseConnection();
    app.listen(PORT, () => {
      console.log(`☕ Coffee Bean Backend Server running on http://localhost:${PORT}`);
      if (isCloudinaryConfigured()) {
        console.log(`☁️ Image Storage: Cloudinary active (uploads stream directly to Cloudinary)`);
      } else {
        console.log(`📁 Image Storage: Local fallback active (/uploads) — add Cloudinary credentials to .env to enable Cloudinary`);
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
