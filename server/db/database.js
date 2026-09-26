/**
 * ─── Catalog Maker: Database Initialization & Schema ───
 * 
 * Creates all tables, indexes, and default configuration rows.
 * Uses better-sqlite3 for synchronous, ultra-fast local queries.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'catalog.db');

// Ensure the directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;

/**
 * Get or create the database singleton connection.
 */
function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    
    // Performance pragmas for speed
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000');  // 64MB cache
    db.pragma('foreign_keys = ON');
    db.pragma('temp_store = MEMORY');
    
    console.log(`[DB] Connected to SQLite at ${DB_PATH}`);
  }
  return db;
}

/**
 * Initialize all tables and indexes.
 */
function initializeDatabase() {
  const db = getDb();

  db.exec(`
    -- ═══════════════════════════════════════════════
    -- 1. Store Configuration & Settings
    -- ═══════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS catalog_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      store_name TEXT NOT NULL DEFAULT 'KICKS VAULT | Premium Sneakers',
      store_tagline TEXT DEFAULT 'Authenticated Heat. Delivered Fresh.',
      whatsapp_number TEXT NOT NULL DEFAULT '+919876543210',
      whatsapp_default_message TEXT DEFAULT 'Hi, I am interested in these sneakers from your catalog:',
      active_theme TEXT NOT NULL DEFAULT 'editorial_boutique',
      currency_symbol TEXT DEFAULT '₹',
      currency_code TEXT DEFAULT 'INR',
      allow_out_of_stock_enquiry INTEGER DEFAULT 1,
      client_id TEXT DEFAULT 'client_default',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- ═══════════════════════════════════════════════
    -- 2. Categories / Silhouettes
    -- ═══════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      image_url TEXT,
      display_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      parent_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    -- ═══════════════════════════════════════════════
    -- 3. Products (Sneakers & Streetwear)
    -- ═══════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      sku TEXT UNIQUE,
      description TEXT,
      short_description TEXT,
      price REAL NOT NULL,
      compare_at_price REAL,
      category_id TEXT NOT NULL,
      source_platform TEXT NOT NULL DEFAULT 'manual',
      source_id TEXT,
      source_url TEXT,
      stock_status TEXT DEFAULT 'in_stock',
      stock_quantity INTEGER DEFAULT 10,
      is_active INTEGER DEFAULT 1,
      is_featured INTEGER DEFAULT 0,
      metadata TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    -- ═══════════════════════════════════════════════
    -- 4. Product Images (Multi-Angle Photography)
    -- ═══════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS product_images (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      url TEXT NOT NULL,
      thumbnail_url TEXT,
      alt_text TEXT,
      display_order INTEGER DEFAULT 0,
      is_primary INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    -- ═══════════════════════════════════════════════
    -- 5. Synchronization Logs
    -- ═══════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS sync_logs (
      id TEXT PRIMARY KEY,
      source_platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started',
      products_created INTEGER DEFAULT 0,
      products_updated INTEGER DEFAULT 0,
      products_skipped INTEGER DEFAULT 0,
      products_failed INTEGER DEFAULT 0,
      error_message TEXT,
      details TEXT,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP
    );

    -- ═══════════════════════════════════════════════
    -- Performance Indexes
    -- ═══════════════════════════════════════════════
    CREATE INDEX IF NOT EXISTS idx_products_category 
      ON products(category_id, is_active);
    
    CREATE INDEX IF NOT EXISTS idx_products_source 
      ON products(source_platform, source_id);
    
    CREATE INDEX IF NOT EXISTS idx_products_slug 
      ON products(slug);

    CREATE INDEX IF NOT EXISTS idx_products_sku 
      ON products(sku);
    
    CREATE INDEX IF NOT EXISTS idx_products_featured 
      ON products(is_featured, is_active);
    
    CREATE INDEX IF NOT EXISTS idx_products_price 
      ON products(price);

    CREATE INDEX IF NOT EXISTS idx_images_product 
      ON product_images(product_id, display_order);
    
    CREATE INDEX IF NOT EXISTS idx_categories_slug 
      ON categories(slug);
    
    CREATE INDEX IF NOT EXISTS idx_categories_order 
      ON categories(display_order, is_active);

    CREATE INDEX IF NOT EXISTS idx_sync_logs_platform 
      ON sync_logs(source_platform, started_at);
  `);

  // Insert default settings if empty, or sync whatsapp_number from env
  const waNumber = process.env.WHATSAPP_NUMBER || '+91702110947';
  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM catalog_settings').get();
  if (settingsCount.count === 0) {
    db.prepare(`
      INSERT INTO catalog_settings (id, store_name, store_tagline, whatsapp_number, active_theme)
      VALUES (1, 'KICKS VAULT | Premium Sneakers', 'Authenticated Heat. Delivered Fresh.', @waNumber, 'editorial_boutique')
    `).run({ waNumber });
    console.log('[DB] Default catalog settings inserted with WhatsApp number:', waNumber);
  } else if (process.env.WHATSAPP_NUMBER) {
    db.prepare(`
      UPDATE catalog_settings SET whatsapp_number = @waNumber WHERE id = 1
    `).run({ waNumber: process.env.WHATSAPP_NUMBER });
    console.log('[DB] Synced catalog_settings WhatsApp number from env:', process.env.WHATSAPP_NUMBER);
  }

  console.log('[DB] All tables and indexes initialized successfully.');
}

/**
 * Close the database connection gracefully.
 */
function closeDb() {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] Connection closed.');
  }
}

module.exports = { getDb, initializeDatabase, closeDb };
