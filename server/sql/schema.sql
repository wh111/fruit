-- 四季果先 · 正式库表（腾讯云/阿里云 MySQL 5.7+ / 8.0）
-- 在云数据库控制台执行本文件，或：mysql -h... -u... -p < sql/schema.sql

CREATE DATABASE IF NOT EXISTS sijiguoxian DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE sijiguoxian;

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description VARCHAR(512) DEFAULT '',
  cover VARCHAR(512) DEFAULT '',
  category VARCHAR(64) DEFAULT '经典果切',
  status TINYINT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  specs JSON NOT NULL,
  extras JSON NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(64) PRIMARY KEY,
  order_no VARCHAR(64) NOT NULL UNIQUE,
  user_id VARCHAR(64) NULL,
  openid VARCHAR(128) NULL,
  product_id VARCHAR(64) NULL,
  product_name VARCHAR(128) NOT NULL,
  cover VARCHAR(512) DEFAULT '',
  spec_id VARCHAR(32) NOT NULL,
  spec_name VARCHAR(64) NOT NULL,
  extras JSON NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  amount DECIMAL(10,2) NOT NULL,
  remark VARCHAR(255) DEFAULT '',
  status VARCHAR(32) NOT NULL,
  pickup_code VARCHAR(16) NULL,
  qr_payload TEXT NULL,
  pay_mode VARCHAR(32) NULL,
  transaction_id VARCHAR(128) NULL,
  prepay_id VARCHAR(128) NULL,
  printed TINYINT NOT NULL DEFAULT 0,
  printed_at BIGINT NULL,
  paid_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  raw JSON NULL,
  INDEX idx_orders_status (status),
  INDEX idx_orders_paid (paid_at),
  INDEX idx_orders_pickup (pickup_code),
  INDEX idx_orders_openid (openid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  openid VARCHAR(128) NOT NULL UNIQUE,
  nick_name VARCHAR(128) DEFAULT '',
  avatar_url VARCHAR(512) DEFAULT '',
  phone VARCHAR(32) DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_users_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_meta (
  meta_key VARCHAR(64) PRIMARY KEY,
  meta_value JSON NOT NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
