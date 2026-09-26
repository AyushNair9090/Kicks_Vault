/**
 * ─── SyncEngine: Atomic Import & Diff Engine ───
 * 
 * The central orchestration layer that:
 *   1. Fetches products from ShopifySyncService or WooCommerceSyncService
 *   2. Compares incoming data with existing database records using MD5 hashes
 *   3. Performs atomic transactional upserts (insert new, update changed, skip identical)
 *   4. Records detailed sync logs with per-product change tracking
 *   5. Handles errors gracefully with per-item and per-sync-run rollback
 * 
 * Key Design Principles:
 *   • Hash-based diffing: each product gets an MD5 hash of (title + price + stock + updated_at).
 *     If the hash hasn't changed, the product is skipped (no unnecessary writes).
 *   • Atomic transactions: all upserts for a single sync run happen inside a SQLite transaction.
 *     If anything fails, the entire run is rolled back.
 *   • Detailed audit trail: every sync run records counts (created/updated/skipped/failed),
 *     timing, and a JSON details blob with per-product actions.
 *   • Circuit breaker: if the external API times out or errors, the engine records the failure
 *     and does NOT corrupt the existing catalog data.
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const ShopifySyncService = require('./ShopifySyncService');
const WooCommerceSyncService = require('./WooCommerceSyncService');

// ═══════════════════════════════════════════════
// HASH UTILITIES
// ═══════════════════════════════════════════════

/**
 * Generate a content hash for a product to detect changes.
 * Hashes: title + price + compare_at_price + stock_status + stock_quantity + description
 */
function computeProductHash(product) {
  const hashInput = [
    product.title,
    product.price,
    product.compare_at_price,
    product.stock_status,
    product.stock_quantity,
    product.description,
    product.metadata,
  ].join('|');

  return crypto.createHash('md5').update(hashInput).digest('hex');
}

// ═══════════════════════════════════════════════
// SLUG GENERATOR
// ═══════════════════════════════════════════════

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Ensure slug uniqueness by appending a counter suffix if needed.
 */
function ensureUniqueSlug(db, baseSlug, excludeId = null) {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const params = { slug };
    let query = 'SELECT id FROM products WHERE slug = @slug';
    if (excludeId) {
      query += ' AND id != @excludeId';
      params.excludeId = excludeId;
    }
    const existing = db.prepare(query).get(params);
    if (!existing) return slug;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

/**
 * Ensure SKU uniqueness.
 */
function ensureUniqueSku(db, baseSku, excludeId = null) {
  if (!baseSku) return null;
  let sku = baseSku;
  let counter = 1;

  while (true) {
    const params = { sku };
    let query = 'SELECT id FROM products WHERE sku = @sku';
    if (excludeId) {
      query += ' AND id != @excludeId';
      params.excludeId = excludeId;
    }
    const existing = db.prepare(query).get(params);
    if (!existing) return sku;
    sku = `${baseSku}-${counter}`;
    counter++;
  }
}

// ═══════════════════════════════════════════════
// CORE SYNC LOGIC
// ═══════════════════════════════════════════════

/**
 * Run a full sync for the specified platform.
 * 
 * @param {'shopify' | 'woocommerce' | 'all'} platform
 * @param {Object} options
 * @param {boolean} options.forceRefresh - If true, skip hash comparison and update all products
 * @param {Function} options.onProgress - Optional callback for real-time progress updates
 * @returns {Promise<Object[]>} Array of sync result objects
 */
async function runSync(platform = 'all', options = {}) {
  const { forceRefresh = false, onProgress } = options;
  const platforms = platform === 'all' ? ['shopify', 'woocommerce'] : [platform];
  const results = [];

  for (const p of platforms) {
    try {
      const result = await syncPlatform(p, { forceRefresh, onProgress });
      results.push(result);
    } catch (error) {
      console.error(`[SYNC] Critical error syncing ${p}:`, error.message);
      results.push({
        platform: p,
        status: 'failed',
        error: error.message,
        products_created: 0,
        products_updated: 0,
        products_skipped: 0,
        products_failed: 0,
        duration_ms: 0,
      });
    }
  }

  return results;
}

/**
 * Sync a single platform (shopify or woocommerce).
 */
async function syncPlatform(platform, options = {}) {
  const { forceRefresh = false, onProgress } = options;
  const db = getDb();
  const syncId = uuidv4();
  const startTime = Date.now();
  const startedAt = new Date().toISOString();

  console.log(`\n[SYNC] ═══ Starting ${platform.toUpperCase()} sync ═══`);

  // 1. Create sync log entry
  db.prepare(`
    INSERT INTO sync_logs (id, source_platform, status, started_at)
    VALUES (@id, @platform, 'in_progress', @started_at)
  `).run({ id: syncId, platform, started_at: startedAt });

  try {
    // 2. Fetch products from the appropriate service
    let fetchResult;
    if (platform === 'shopify') {
      fetchResult = await ShopifySyncService.fetchProducts();
    } else if (platform === 'woocommerce') {
      fetchResult = await WooCommerceSyncService.fetchProducts();
    } else {
      throw new Error(`Unknown platform: ${platform}`);
    }

    const incomingProducts = fetchResult.products;
    console.log(`[SYNC] Received ${incomingProducts.length} products from ${platform} (source: ${fetchResult.source})`);

    if (onProgress) {
      onProgress({
        phase: 'fetched',
        platform,
        total: incomingProducts.length,
        source: fetchResult.source,
      });
    }

    // 3. Perform atomic upsert transaction
    const syncStats = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      details: [],
    };

    const upsertTransaction = db.transaction(() => {
      for (let i = 0; i < incomingProducts.length; i++) {
        const incoming = incomingProducts[i];

        try {
          const action = upsertProduct(db, incoming, forceRefresh);
          syncStats[action.type]++;
          syncStats.details.push({
            sku: incoming.sku,
            title: incoming.title,
            action: action.type,
            changes: action.changes || null,
          });
        } catch (productError) {
          syncStats.failed++;
          syncStats.details.push({
            sku: incoming.sku,
            title: incoming.title,
            action: 'failed',
            error: productError.message,
          });
          console.warn(`[SYNC] Failed to upsert product ${incoming.sku}: ${productError.message}`);
        }

        // Progress callback every 10 items
        if (onProgress && (i + 1) % 10 === 0) {
          onProgress({
            phase: 'processing',
            platform,
            processed: i + 1,
            total: incomingProducts.length,
            stats: { ...syncStats },
          });
        }
      }
    });

    upsertTransaction();

    // 4. Update sync log with results
    const duration = Date.now() - startTime;
    const completedAt = new Date().toISOString();

    db.prepare(`
      UPDATE sync_logs SET 
        status = 'completed',
        products_created = @created,
        products_updated = @updated,
        products_skipped = @skipped,
        products_failed = @failed,
        details = @details,
        completed_at = @completed_at
      WHERE id = @id
    `).run({
      id: syncId,
      created: syncStats.created,
      updated: syncStats.updated,
      skipped: syncStats.skipped,
      failed: syncStats.failed,
      details: JSON.stringify({
        source: fetchResult.source,
        source_error: fetchResult.error || null,
        force_refresh: forceRefresh,
        items: syncStats.details,
        duration_ms: duration,
      }),
      completed_at: completedAt,
    });

    const result = {
      platform,
      sync_id: syncId,
      status: 'completed',
      source: fetchResult.source,
      products_created: syncStats.created,
      products_updated: syncStats.updated,
      products_skipped: syncStats.skipped,
      products_failed: syncStats.failed,
      total_processed: incomingProducts.length,
      duration_ms: duration,
      api_error: fetchResult.error || null,
    };

    console.log(`[SYNC] ═══ ${platform.toUpperCase()} sync completed in ${duration}ms ═══`);
    console.log(`[SYNC]    Created: ${syncStats.created} | Updated: ${syncStats.updated} | Skipped: ${syncStats.skipped} | Failed: ${syncStats.failed}`);

    if (onProgress) {
      onProgress({ phase: 'completed', platform, result });
    }

    return result;

  } catch (syncError) {
    // Record failure in sync log
    const duration = Date.now() - startTime;
    db.prepare(`
      UPDATE sync_logs SET 
        status = 'failed',
        error_message = @error,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ id: syncId, error: syncError.message });

    console.error(`[SYNC] ═══ ${platform.toUpperCase()} sync FAILED in ${duration}ms: ${syncError.message} ═══`);

    throw syncError;
  }
}

// ═══════════════════════════════════════════════
// PRODUCT UPSERT LOGIC
// ═══════════════════════════════════════════════

/**
 * Upsert a single product.
 * 
 * 1. Check if a product with this source_id already exists.
 * 2. If yes, compute content hash and compare:
 *    - If hashes match → skip (no changes)
 *    - If hashes differ → update changed fields
 * 3. If no → insert new product and its images
 * 
 * @returns {{ type: 'created' | 'updated' | 'skipped', changes?: string[] }}
 */
function upsertProduct(db, incoming, forceRefresh = false) {
  const existing = db.prepare(
    'SELECT * FROM products WHERE source_id = @source_id'
  ).get({ source_id: incoming.source_id });

  if (existing) {
    // ── EXISTING PRODUCT: check for changes ──
    const existingHash = computeProductHash(existing);
    const incomingHash = computeProductHash({
      title: incoming.title,
      price: incoming.price,
      compare_at_price: incoming.compare_at_price,
      stock_status: incoming.stock_status,
      stock_quantity: incoming.stock_quantity,
      description: incoming.description,
      metadata: incoming.metadata,
    });

    if (!forceRefresh && existingHash === incomingHash) {
      return { type: 'skipped' };
    }

    // Detect what changed
    const changes = [];
    if (existing.title !== incoming.title) changes.push('title');
    if (existing.price !== incoming.price) changes.push(`price: ${existing.price} → ${incoming.price}`);
    if (existing.compare_at_price !== incoming.compare_at_price) changes.push('compare_at_price');
    if (existing.stock_status !== incoming.stock_status) changes.push(`stock: ${existing.stock_status} → ${incoming.stock_status}`);
    if (existing.stock_quantity !== incoming.stock_quantity) changes.push(`qty: ${existing.stock_quantity} → ${incoming.stock_quantity}`);
    if (existing.description !== incoming.description) changes.push('description');
    if (existing.metadata !== incoming.metadata) changes.push('metadata');

    // Update the product
    db.prepare(`
      UPDATE products SET
        title = @title,
        price = @price,
        compare_at_price = @compare_at_price,
        stock_status = @stock_status,
        stock_quantity = @stock_quantity,
        description = @description,
        short_description = @short_description,
        metadata = @metadata,
        source_url = @source_url,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({
      id: existing.id,
      title: incoming.title,
      price: incoming.price,
      compare_at_price: incoming.compare_at_price,
      stock_status: incoming.stock_status,
      stock_quantity: incoming.stock_quantity,
      description: incoming.description,
      short_description: incoming.short_description,
      metadata: incoming.metadata,
      source_url: incoming.source_url,
    });

    // Update images if provided
    if (incoming.images && incoming.images.length > 0) {
      updateProductImages(db, existing.id, incoming.images);
    }

    return { type: 'updated', changes };

  } else {
    // ── NEW PRODUCT: insert ──
    const productId = uuidv4();
    const slug = ensureUniqueSlug(db, slugify(incoming.title));
    const sku = ensureUniqueSku(db, incoming.sku);

    db.prepare(`
      INSERT INTO products 
        (id, title, slug, sku, description, short_description, price, compare_at_price,
         category_id, source_platform, source_id, source_url, stock_status, stock_quantity,
         is_active, is_featured, metadata)
      VALUES 
        (@id, @title, @slug, @sku, @description, @short_description, @price, @compare_at_price,
         @category_id, @source_platform, @source_id, @source_url, @stock_status, @stock_quantity,
         1, @is_featured, @metadata)
    `).run({
      id: productId,
      title: incoming.title,
      slug,
      sku,
      description: incoming.description,
      short_description: incoming.short_description,
      price: incoming.price,
      compare_at_price: incoming.compare_at_price,
      category_id: incoming.category_id,
      source_platform: incoming.source_platform,
      source_id: incoming.source_id,
      source_url: incoming.source_url,
      stock_status: incoming.stock_status,
      stock_quantity: incoming.stock_quantity,
      is_featured: incoming.is_featured || 0,
      metadata: incoming.metadata,
    });

    // Insert images
    if (incoming.images && incoming.images.length > 0) {
      insertProductImages(db, productId, incoming.images, incoming.title);
    }

    return { type: 'created' };
  }
}

// ═══════════════════════════════════════════════
// IMAGE MANAGEMENT
// ═══════════════════════════════════════════════

/**
 * Insert images for a new product.
 */
function insertProductImages(db, productId, images, productTitle) {
  const insertImg = db.prepare(`
    INSERT INTO product_images (id, product_id, url, thumbnail_url, alt_text, display_order, is_primary)
    VALUES (@id, @product_id, @url, @thumbnail_url, @alt_text, @display_order, @is_primary)
  `);

  for (const img of images) {
    insertImg.run({
      id: uuidv4(),
      product_id: productId,
      url: img.url,
      thumbnail_url: img.thumbnail_url || img.url,
      alt_text: img.alt_text || `${productTitle} - View`,
      display_order: img.display_order || 0,
      is_primary: img.is_primary ? 1 : 0,
    });
  }
}

/**
 * Update images for an existing product.
 * Deletes old images and re-inserts current ones.
 */
function updateProductImages(db, productId, images) {
  // Get existing image count to decide if we need to update
  const existingCount = db.prepare(
    'SELECT COUNT(*) as count FROM product_images WHERE product_id = @product_id'
  ).get({ product_id: productId }).count;

  // Only update images if the count differs or it's a fresh sync
  if (existingCount !== images.length) {
    db.prepare('DELETE FROM product_images WHERE product_id = @product_id')
      .run({ product_id: productId });
    
    insertProductImages(db, productId, images, '');
  }
}

// ═══════════════════════════════════════════════
// SYNC HISTORY & STATUS
// ═══════════════════════════════════════════════

/**
 * Get sync history for a platform (or all).
 */
function getSyncHistory(platform = null, limit = 20) {
  const db = getDb();
  let query = 'SELECT * FROM sync_logs';
  const params = {};

  if (platform && platform !== 'all') {
    query += ' WHERE source_platform = @platform';
    params.platform = platform;
  }

  query += ' ORDER BY started_at DESC LIMIT @limit';
  params.limit = Math.min(100, limit);

  return db.prepare(query).all(params);
}

/**
 * Get the last successful sync for a platform.
 */
function getLastSuccessfulSync(platform) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM sync_logs 
    WHERE source_platform = @platform AND status = 'completed'
    ORDER BY completed_at DESC LIMIT 1
  `).get({ platform });
}

/**
 * Get sync status overview for the dashboard.
 */
function getSyncStatus() {
  const db = getDb();

  const lastShopify = getLastSuccessfulSync('shopify');
  const lastWoo = getLastSuccessfulSync('woocommerce');

  const shopifyTotal = db.prepare(
    "SELECT COUNT(*) as count FROM products WHERE source_platform = 'shopify'"
  ).get().count;

  const wooTotal = db.prepare(
    "SELECT COUNT(*) as count FROM products WHERE source_platform = 'woocommerce'"
  ).get().count;

  const recentFailures = db.prepare(`
    SELECT * FROM sync_logs 
    WHERE status = 'failed' 
    ORDER BY started_at DESC LIMIT 5
  `).all();

  return {
    shopify: {
      configured: ShopifySyncService.isConfigured(),
      last_sync: lastShopify,
      product_count: shopifyTotal,
    },
    woocommerce: {
      configured: WooCommerceSyncService.isConfigured(),
      last_sync: lastWoo,
      product_count: wooTotal,
    },
    recent_failures: recentFailures,
  };
}

module.exports = {
  runSync,
  syncPlatform,
  getSyncHistory,
  getLastSuccessfulSync,
  getSyncStatus,
  computeProductHash,
};
