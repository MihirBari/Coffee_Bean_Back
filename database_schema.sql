-- =============================================================================
-- Coffee Bean E-Commerce Complete Database Schema
-- Database: coffee_bean_db
-- =============================================================================

CREATE DATABASE IF NOT EXISTS `coffee_bean_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `coffee_bean_db`;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(150) NOT NULL,
  `email` VARCHAR(150) UNIQUE NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `role` ENUM('customer', 'admin') DEFAULT 'customer',
  `is_email_verified` BOOLEAN DEFAULT 0,
  `email_verified_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Products Table
CREATE TABLE IF NOT EXISTS `products` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `tagline` VARCHAR(255) DEFAULT '',
  `description` TEXT,
  `price` DECIMAL(10, 2) NOT NULL,
  `origin` VARCHAR(100) DEFAULT 'Specialty Arabica',
  `roast_level` VARCHAR(50) DEFAULT 'Classic',
  `grind_types` VARCHAR(255) DEFAULT 'Whole Bean, Pour Over, Espresso, French Press',
  `flavor_notes` VARCHAR(255) DEFAULT '',
  `acidity` INT DEFAULT 3,
  `body` INT DEFAULT 3,
  `stock_quantity` INT NOT NULL DEFAULT 50,
  `is_featured` BOOLEAN DEFAULT 0,
  `image_url` VARCHAR(500) DEFAULT '',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Wishlists Table
CREATE TABLE IF NOT EXISTS `wishlists` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `product_id` INT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_user_product` (`user_id`, `product_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Orders Table
CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_number` VARCHAR(60) UNIQUE NOT NULL,
  `user_id` INT NULL,
  `customer_name` VARCHAR(150) NOT NULL,
  `customer_email` VARCHAR(150) NOT NULL,
  `customer_phone` VARCHAR(50) DEFAULT '',
  `shipping_address` TEXT NOT NULL,
  `total_amount` DECIMAL(10, 2) NOT NULL,
  `shipping_fee` DECIMAL(10, 2) DEFAULT 0.00,
  `discount_amount` DECIMAL(10, 2) DEFAULT 0.00,
  `status` ENUM('Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled') DEFAULT 'Pending',
  `payment_method` VARCHAR(80) DEFAULT 'Credit Card (Simulated)',
  `tracking_number` VARCHAR(60) DEFAULT '',
  `courier_name` VARCHAR(100) DEFAULT 'Roastery Express Courier',
  `order_step` INT DEFAULT 2,
  `estimated_delivery` DATE NULL,
  `bean_coins_used` INT DEFAULT 0,
  `bean_coins_earned` INT DEFAULT 0,
  `is_subscription` BOOLEAN DEFAULT 0,
  `subscription_frequency` VARCHAR(50) DEFAULT '',
  `is_verified` BOOLEAN DEFAULT 1,
  `verification_method` VARCHAR(50) DEFAULT 'EMAIL_OTP',
  `security_risk_score` INT DEFAULT 0,
  `client_ip` VARCHAR(50) DEFAULT '',
  `notes` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Order Items Table
CREATE TABLE IF NOT EXISTS `order_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `product_id` INT NOT NULL,
  `product_name` VARCHAR(255) NOT NULL,
  `quantity` INT NOT NULL,
  `unit_price` DECIMAL(10, 2) NOT NULL,
  `grind_type` VARCHAR(100) DEFAULT 'Whole Bean',
  `subtotal` DECIMAL(10, 2) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Store Settings Table
CREATE TABLE IF NOT EXISTS `store_settings` (
  `setting_key` VARCHAR(100) PRIMARY KEY,
  `setting_value` TEXT NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Product Reviews Table
CREATE TABLE IF NOT EXISTS `product_reviews` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `product_id` INT NOT NULL,
  `user_id` INT NULL,
  `reviewer_name` VARCHAR(150) NOT NULL,
  `rating` INT NOT NULL,
  `title` VARCHAR(255) DEFAULT '',
  `comment` TEXT NOT NULL,
  `is_verified_purchase` BOOLEAN DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Coupons Table
CREATE TABLE IF NOT EXISTS `coupons` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(50) UNIQUE NOT NULL,
  `discount_percent` INT NOT NULL,
  `description` VARCHAR(255) DEFAULT '',
  `max_uses` INT DEFAULT 100,
  `used_count` INT DEFAULT 0,
  `min_order_amount` DECIMAL(10, 2) DEFAULT 0.00,
  `expires_at` DATE NULL,
  `is_active` BOOLEAN DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Announcements Table
CREATE TABLE IF NOT EXISTS `announcements` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `message` VARCHAR(500) NOT NULL,
  `banner_type` ENUM('marquee', 'static') DEFAULT 'marquee',
  `coupon_code` VARCHAR(50) DEFAULT '',
  `link_text` VARCHAR(100) DEFAULT '',
  `link_url` VARCHAR(100) DEFAULT '',
  `theme` ENUM('sceptre-red', 'java-dark', 'gold-crema', 'emerald') DEFAULT 'sceptre-red',
  `is_active` BOOLEAN DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Lightning Deals Table
CREATE TABLE IF NOT EXISTS `lightning_deals` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `is_active` BOOLEAN DEFAULT 1,
  `title` VARCHAR(150) NOT NULL DEFAULT '⚡ Roastery Lightning Deals',
  `badge_text` VARCHAR(50) NOT NULL DEFAULT 'Deal of the Day',
  `description` VARCHAR(500) NOT NULL DEFAULT 'Fresh roasted small-batch tins at roaster-direct pricing. Free delivery on > 2 items!',
  `coupon_code` VARCHAR(50) DEFAULT 'FLASH20',
  `discount_percent` INT DEFAULT 20,
  `ends_at` DATETIME NULL,
  `duration_hours` INT DEFAULT 4,
  `claimed_percent` INT DEFAULT 84,
  `items_left` INT DEFAULT 16,
  `show_in_ticker` BOOLEAN DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Customer Return Requests Table
CREATE TABLE IF NOT EXISTS `return_requests` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `order_number` VARCHAR(60) NOT NULL,
  `user_id` INT NULL,
  `customer_name` VARCHAR(150) NOT NULL,
  `customer_email` VARCHAR(150) NOT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `details` TEXT,
  `image_url` VARCHAR(500) NULL,
  `status` ENUM('Pending', 'Approved - Replacement Dispatched', 'Approved - Refund Processed', 'Rejected') DEFAULT 'Pending',
  `resolution_notes` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Customer Saved Addresses Table
CREATE TABLE IF NOT EXISTS `customer_addresses` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `label` VARCHAR(50) DEFAULT 'Home',
  `recipient_name` VARCHAR(150) NOT NULL,
  `phone` VARCHAR(50) NOT NULL,
  `address_line` TEXT NOT NULL,
  `house_flat` VARCHAR(150) DEFAULT '',
  `street_locality` VARCHAR(255) DEFAULT '',
  `city` VARCHAR(100) DEFAULT '',
  `state` VARCHAR(100) DEFAULT '',
  `pincode` VARCHAR(10) NOT NULL,
  `is_default` BOOLEAN DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. Bean Coins Wallets Table
CREATE TABLE IF NOT EXISTS `bean_coins_wallets` (
  `user_id` INT PRIMARY KEY,
  `balance` INT DEFAULT 150,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. Product Questions Table (Q&A)
CREATE TABLE IF NOT EXISTS `product_questions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `product_id` INT NOT NULL,
  `user_name` VARCHAR(150) NOT NULL,
  `question` TEXT NOT NULL,
  `answer` TEXT NULL,
  `answered_by` VARCHAR(100) DEFAULT 'Master Roaster',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 15. Email Verifications (OTP) Table
CREATE TABLE IF NOT EXISTS `email_verifications` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(150) NOT NULL,
  `otp_code` VARCHAR(10) NOT NULL,
  `purpose` ENUM('registration', 'order_checkout', 'login_verify', 'cod_confirm') NOT NULL DEFAULT 'order_checkout',
  `expires_at` DATETIME NOT NULL,
  `attempts_left` INT DEFAULT 5,
  `is_used` BOOLEAN DEFAULT 0,
  `ip_address` VARCHAR(50) DEFAULT '',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_email` (`email`),
  INDEX `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 16. Security Audit Logs Table
CREATE TABLE IF NOT EXISTS `security_audit_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `event_type` VARCHAR(60) NOT NULL,
  `severity` ENUM('INFO', 'WARNING', 'BLOCKED_ATTACK') DEFAULT 'INFO',
  `ip_address` VARCHAR(50) DEFAULT '',
  `email` VARCHAR(150) DEFAULT '',
  `details` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_event` (`event_type`),
  INDEX `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 17. Traffic Logs Table
CREATE TABLE IF NOT EXISTS `traffic_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `page_path` VARCHAR(255) NOT NULL,
  `page_title` VARCHAR(255) NOT NULL,
  `visitor_id` VARCHAR(100) NOT NULL,
  `user_id` INT NULL,
  `referrer` VARCHAR(255) DEFAULT '',
  `user_agent` VARCHAR(255) DEFAULT '',
  `ip_address` VARCHAR(60) DEFAULT '',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_created_at` (`created_at`),
  INDEX `idx_page_path` (`page_path`),
  INDEX `idx_visitor` (`visitor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 18. Product Events Table
CREATE TABLE IF NOT EXISTS `product_events` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `product_id` INT NOT NULL,
  `event_type` ENUM('view', 'add_to_cart', 'wishlist') NOT NULL,
  `visitor_id` VARCHAR(100) NOT NULL,
  `user_id` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_product_event` (`product_id`, `event_type`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 19. Order Dispatch & Delivery Notifications (Email & SMS) Table
CREATE TABLE IF NOT EXISTS `order_notifications` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `order_number` VARCHAR(60) NOT NULL,
  `customer_name` VARCHAR(150) NOT NULL,
  `recipient_email` VARCHAR(150),
  `recipient_phone` VARCHAR(50),
  `channel` ENUM('EMAIL', 'SMS') NOT NULL,
  `event` ENUM('ORDER_PLACED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED') NOT NULL,
  `status` ENUM('SENT', 'SIMULATED', 'FAILED') DEFAULT 'SENT',
  `subject` VARCHAR(255) DEFAULT '',
  `message` TEXT NOT NULL,
  `gateway_response` TEXT,
  `sent_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_order_id` (`order_id`),
  INDEX `idx_event` (`event`),
  INDEX `idx_channel` (`channel`),
  INDEX `idx_sent_at` (`sent_at`),
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
