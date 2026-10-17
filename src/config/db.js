const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'coffee_bean_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

/**
 * Lightweight connection health check executed on server startup.
 * Confirms MariaDB/MySQL is active and responsive without executing DDL or mock seeders.
 */
async function checkDatabaseConnection() {
  try {
    const [rows] = await pool.query('SELECT 1 + 1 AS test');
    console.log(`✅ MariaDB/MySQL connected successfully to database "${process.env.DB_NAME || 'coffee_bean_db'}"`);
    return true;
  } catch (error) {
    console.error('❌ Database connection error:', error.message);
    throw error;
  }
}

module.exports = {
  pool,
  checkDatabaseConnection,
};
