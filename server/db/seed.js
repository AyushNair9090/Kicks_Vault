/**
 * ─── Catalog Maker: Database Initializer & Seed ───
 * 
 * Initializes the default 8 categories and catalog settings.
 * If Shopify credentials exist in .env and the products table is empty,
 * it automatically triggers an initial sync directly from the live API.
 */

const { getDb, initializeDatabase } = require('./database');
const SyncEngine = require('../services/SyncEngine');
const ShopifySyncService = require('../services/ShopifySyncService');

// ═══════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════
const categories = [
  {
    id: 'cat-retro-high',
    name: 'Retro High-Tops',
    slug: 'retro-high-tops',
    description: 'Iconic high-top silhouettes from legendary basketball heritage lines. OG colorways and retro re-releases.',
    display_order: 1,
  },
  {
    id: 'cat-low-top',
    name: 'Low-Top Classics',
    slug: 'low-top-classics',
    description: 'Clean, versatile low-profile sneakers for everyday rotation and effortless street style.',
    display_order: 2,
  },
  {
    id: 'cat-runners',
    name: 'Running & Lifestyle',
    slug: 'running-lifestyle',
    description: 'Premium performance runners and lifestyle silhouettes blending tech innovation with modern design.',
    display_order: 3,
  },
  {
    id: 'cat-skate',
    name: 'Skate & Canvas',
    slug: 'skate-canvas',
    description: 'Board-ready skate shoes and classic canvas silhouettes with vulcanized construction.',
    display_order: 4,
  },
  {
    id: 'cat-collabs',
    name: 'Collabs & Grails',
    slug: 'collabs-grails',
    description: 'Limited-edition designer collaborations and all-time grail sneakers. The most coveted drops.',
    display_order: 5,
  },
  {
    id: 'cat-basketball',
    name: 'Basketball Performance',
    slug: 'basketball-performance',
    description: 'Court-ready performance basketball shoes with cutting-edge cushioning and traction.',
    display_order: 6,
  },
  {
    id: 'cat-boots',
    name: 'Boots & Outdoor',
    slug: 'boots-outdoor',
    description: 'Rugged sneaker-boots and outdoor-ready silhouettes built for all-weather versatility.',
    display_order: 7,
  },
  {
    id: 'cat-apparel',
    name: 'Streetwear Apparel',
    slug: 'streetwear-apparel',
    description: 'Complementary streetwear essentials — hoodies, tees, joggers, and accessories.',
    display_order: 8,
  },
];

async function seedDatabase() {
  initializeDatabase();
  const db = getDb();

  // 1. Seed Categories if empty
  const categoryCount = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
  if (categoryCount === 0) {
    const insertCat = db.prepare(`
      INSERT OR IGNORE INTO categories (id, name, slug, description, display_order)
      VALUES (@id, @name, @slug, @description, @display_order)
    `);
    const seedCategories = db.transaction(() => {
      categories.forEach(cat => insertCat.run(cat));
    });
    seedCategories();
    console.log(`[SEED] Seeded ${categories.length} categories.`);
  }

  // 2. Check if products table is empty
  const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  if (productCount > 0) {
    console.log(`[SEED] Database already contains ${productCount} products. Skipping product seed.`);
    return;
  }

  // 3. If empty, sync live products from configured platforms
  if (ShopifySyncService.isConfigured()) {
    console.log('[SEED] Products table is empty. Running initial sync from live Shopify API...');
    try {
      const results = await SyncEngine.runSync('shopify');
      console.log(`[SEED] Initial Shopify sync completed: ${results[0]?.products_created || 0} products imported.`);
    } catch (err) {
      console.warn('[SEED] Initial Shopify sync failed:', err.message);
    }
  }

  const WooCommerceSyncService = require('../services/WooCommerceSyncService');
  if (WooCommerceSyncService.isConfigured()) {
    console.log('[SEED] Running initial sync from live WooCommerce API...');
    try {
      const wooResults = await SyncEngine.runSync('woocommerce');
      console.log(`[SEED] Initial WooCommerce sync completed: ${wooResults[0]?.products_created || 0} products imported.`);
    } catch (err) {
      console.warn('[SEED] Initial WooCommerce sync failed:', err.message);
    }
  }
}

module.exports = { seedDatabase, categories };

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
  seedDatabase().then(() => {
    console.log('[SEED] Database initialization complete.');
    process.exit(0);
  });
}
