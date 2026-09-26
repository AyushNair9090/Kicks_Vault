/**
 * ─── Admin API Routes ───
 * 
 * Backend management endpoints for products, categories,
 * sync controls, and settings.
 * 
 * GET    /api/admin/dashboard       → Summary metrics
 * GET    /api/admin/settings        → Current settings
 * PUT    /api/admin/settings        → Update settings
 * GET    /api/admin/products        → All products (admin view)
 * POST   /api/admin/products        → Create product
 * PUT    /api/admin/products/:id    → Update product
 * DELETE /api/admin/products/:id    → Delete product
 * GET    /api/admin/categories      → All categories
 * POST   /api/admin/categories      → Create category
 * PUT    /api/admin/categories/:id  → Update category
 * DELETE /api/admin/categories/:id  → Delete category
 * POST   /api/admin/sync/run       → Trigger sync
 * GET    /api/admin/sync/history    → Sync log history
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { requireAdminAuth, handleLogin, handleVerify, handleLogout } = require('../middleware/auth');

// ═══════════════════════════════════════════════
// AUTHENTICATION ENDPOINTS (Public)
// ═══════════════════════════════════════════════
router.post('/auth/login', handleLogin);
router.get('/auth/verify', handleVerify);
router.post('/auth/logout', handleLogout);

// Enforce password authentication on all admin management endpoints below
router.use(requireAdminAuth);

// ═══════════════════════════════════════════════
// DASHBOARD — Summary metrics
// ═══════════════════════════════════════════════
router.get('/dashboard', (req, res) => {
  try {
    const db = getDb();

    const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
    const activeProducts = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1').get().count;
    const totalCategories = db.prepare('SELECT COUNT(*) as count FROM categories WHERE is_active = 1').get().count;
    const outOfStock = db.prepare("SELECT COUNT(*) as count FROM products WHERE stock_status = 'out_of_stock'").get().count;
    const shopifyProducts = db.prepare("SELECT COUNT(*) as count FROM products WHERE source_platform = 'shopify'").get().count;
    const wooProducts = db.prepare("SELECT COUNT(*) as count FROM products WHERE source_platform = 'woocommerce'").get().count;
    const manualProducts = db.prepare("SELECT COUNT(*) as count FROM products WHERE source_platform = 'manual'").get().count;
    const featuredProducts = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_featured = 1').get().count;
    
    const lastSync = db.prepare(`
      SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 1
    `).get();

    const settings = db.prepare('SELECT active_theme, store_name FROM catalog_settings WHERE id = 1').get();

    res.json({
      metrics: {
        total_products: totalProducts,
        active_products: activeProducts,
        total_categories: totalCategories,
        out_of_stock: outOfStock,
        featured_products: featuredProducts,
        sources: {
          shopify: shopifyProducts,
          woocommerce: wooProducts,
          manual: manualProducts,
        },
      },
      active_theme: settings?.active_theme || 'editorial_boutique',
      store_name: settings?.store_name || 'KICKS VAULT',
      last_sync: lastSync || null,
    });
  } catch (error) {
    console.error('[ADMIN] Dashboard error:', error.message);
    res.status(500).json({ error: { message: 'Failed to load dashboard.' } });
  }
});

// ═══════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════
router.get('/settings', (req, res) => {
  try {
    const db = getDb();
    const settings = db.prepare('SELECT * FROM catalog_settings WHERE id = 1').get();
    res.json({ settings: settings || {} });
  } catch (error) {
    console.error('[ADMIN] Settings GET error:', error.message);
    res.status(500).json({ error: { message: 'Failed to load settings.' } });
  }
});

router.put('/settings', (req, res) => {
  try {
    const db = getDb();
    const {
      store_name,
      store_tagline,
      whatsapp_number,
      whatsapp_default_message,
      active_theme,
      currency_symbol,
      allow_out_of_stock_enquiry,
    } = req.body;

    const updates = [];
    const params = {};

    if (store_name !== undefined) { updates.push('store_name = @store_name'); params.store_name = store_name; }
    if (store_tagline !== undefined) { updates.push('store_tagline = @store_tagline'); params.store_tagline = store_tagline; }
    if (whatsapp_number !== undefined) { updates.push('whatsapp_number = @whatsapp_number'); params.whatsapp_number = whatsapp_number; }
    if (whatsapp_default_message !== undefined) { updates.push('whatsapp_default_message = @whatsapp_default_message'); params.whatsapp_default_message = whatsapp_default_message; }
    if (active_theme !== undefined) { updates.push('active_theme = @active_theme'); params.active_theme = active_theme; }
    if (currency_symbol !== undefined) { updates.push('currency_symbol = @currency_symbol'); params.currency_symbol = currency_symbol; }
    if (allow_out_of_stock_enquiry !== undefined) { updates.push('allow_out_of_stock_enquiry = @allow_out_of_stock_enquiry'); params.allow_out_of_stock_enquiry = allow_out_of_stock_enquiry ? 1 : 0; }

    if (updates.length === 0) {
      return res.status(400).json({ error: { message: 'No fields to update.' } });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    db.prepare(`UPDATE catalog_settings SET ${updates.join(', ')} WHERE id = 1`).run(params);

    const settings = db.prepare('SELECT * FROM catalog_settings WHERE id = 1').get();
    res.json({ message: 'Settings updated successfully.', settings });
  } catch (error) {
    console.error('[ADMIN] Settings PUT error:', error.message);
    res.status(500).json({ error: { message: 'Failed to update settings.' } });
  }
});

// ═══════════════════════════════════════════════
// PRODUCTS CRUD
// ═══════════════════════════════════════════════
router.get('/products', (req, res) => {
  try {
    const db = getDb();
    const { page = 1, limit = 50, search, category, source } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE 1=1';
    const params = {};

    if (search) {
      whereClause += ' AND (p.title LIKE @search OR p.sku LIKE @search)';
      params.search = `%${search}%`;
    }
    if (category) {
      whereClause += ' AND p.category_id = @category';
      params.category = category;
    }
    if (source) {
      whereClause += ' AND p.source_platform = @source';
      params.source = source;
    }

    const total = db.prepare(`SELECT COUNT(*) as count FROM products p ${whereClause}`).get(params).count;

    const products = db.prepare(`
      SELECT p.*, c.name as category_name,
             pi.url as primary_image_url
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
      ${whereClause}
      ORDER BY p.updated_at DESC
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit: limitNum, offset });

    res.json({
      products: products.map(p => ({
        ...p,
        metadata: p.metadata ? JSON.parse(p.metadata) : null,
      })),
      pagination: { page: pageNum, limit: limitNum, total, total_pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('[ADMIN] Products list error:', error.message);
    res.status(500).json({ error: { message: 'Failed to load products.' } });
  }
});

router.post('/products', (req, res) => {
  try {
    const db = getDb();
    const { title, sku, description, short_description, price, compare_at_price, category_id, stock_status, stock_quantity, is_featured, metadata, images } = req.body;

    if (!title || !price || !category_id) {
      return res.status(400).json({ error: { message: 'Title, price, and category are required.' } });
    }

    const id = uuidv4();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    db.prepare(`
      INSERT INTO products (id, title, slug, sku, description, short_description, price, compare_at_price, category_id, source_platform, stock_status, stock_quantity, is_featured, metadata)
      VALUES (@id, @title, @slug, @sku, @description, @short_description, @price, @compare_at_price, @category_id, 'manual', @stock_status, @stock_quantity, @is_featured, @metadata)
    `).run({
      id, title, slug,
      sku: sku || null,
      description: description || null,
      short_description: short_description || null,
      price,
      compare_at_price: compare_at_price || null,
      category_id,
      stock_status: stock_status || 'in_stock',
      stock_quantity: stock_quantity || 10,
      is_featured: is_featured ? 1 : 0,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });

    // Insert images if provided
    if (images && Array.isArray(images)) {
      const insertImg = db.prepare(`
        INSERT INTO product_images (id, product_id, url, thumbnail_url, alt_text, display_order, is_primary)
        VALUES (@id, @product_id, @url, @thumbnail_url, @alt_text, @display_order, @is_primary)
      `);
      images.forEach((img, idx) => {
        insertImg.run({
          id: uuidv4(),
          product_id: id,
          url: img.url,
          thumbnail_url: img.thumbnail_url || img.url,
          alt_text: img.alt_text || `${title} - Image ${idx + 1}`,
          display_order: idx,
          is_primary: idx === 0 ? 1 : 0,
        });
      });
    }

    res.status(201).json({ message: 'Product created.', product: { id, title, slug } });
  } catch (error) {
    console.error('[ADMIN] Product create error:', error.message);
    res.status(500).json({ error: { message: 'Failed to create product.' } });
  }
});

router.put('/products/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const fields = req.body;

    const existing = db.prepare('SELECT id FROM products WHERE id = @id').get({ id });
    if (!existing) {
      return res.status(404).json({ error: { message: 'Product not found.' } });
    }

    const allowedFields = ['title', 'sku', 'description', 'short_description', 'price', 'compare_at_price', 'category_id', 'stock_status', 'stock_quantity', 'is_active', 'is_featured'];
    const updates = [];
    const params = { id };

    for (const field of allowedFields) {
      if (fields[field] !== undefined) {
        updates.push(`${field} = @${field}`);
        params[field] = fields[field];
      }
    }

    if (fields.metadata !== undefined) {
      updates.push('metadata = @metadata');
      params.metadata = JSON.stringify(fields.metadata);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: { message: 'No fields to update.' } });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = @id`).run(params);

    res.json({ message: 'Product updated.' });
  } catch (error) {
    console.error('[ADMIN] Product update error:', error.message);
    res.status(500).json({ error: { message: 'Failed to update product.' } });
  }
});

router.delete('/products/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    
    const result = db.prepare('DELETE FROM products WHERE id = @id').run({ id });
    
    if (result.changes === 0) {
      return res.status(404).json({ error: { message: 'Product not found.' } });
    }

    res.json({ message: 'Product deleted.' });
  } catch (error) {
    console.error('[ADMIN] Product delete error:', error.message);
    res.status(500).json({ error: { message: 'Failed to delete product.' } });
  }
});

// ═══════════════════════════════════════════════
// CATEGORIES CRUD
// ═══════════════════════════════════════════════
router.get('/categories', (req, res) => {
  try {
    const db = getDb();
    const categories = db.prepare(`
      SELECT c.*, COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY c.display_order ASC
    `).all();
    res.json({ categories });
  } catch (error) {
    console.error('[ADMIN] Categories error:', error.message);
    res.status(500).json({ error: { message: 'Failed to load categories.' } });
  }
});

router.post('/categories', (req, res) => {
  try {
    const db = getDb();
    const { name, description, display_order } = req.body;

    if (!name) {
      return res.status(400).json({ error: { message: 'Category name is required.' } });
    }

    const id = uuidv4();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    db.prepare(`
      INSERT INTO categories (id, name, slug, description, display_order)
      VALUES (@id, @name, @slug, @description, @display_order)
    `).run({
      id, name, slug,
      description: description || null,
      display_order: display_order || 0,
    });

    res.status(201).json({ message: 'Category created.', category: { id, name, slug } });
  } catch (error) {
    console.error('[ADMIN] Category create error:', error.message);
    res.status(500).json({ error: { message: 'Failed to create category.' } });
  }
});

router.put('/categories/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { name, description, display_order, is_active } = req.body;

    const updates = [];
    const params = { id };

    if (name !== undefined) { updates.push('name = @name'); params.name = name; }
    if (description !== undefined) { updates.push('description = @description'); params.description = description; }
    if (display_order !== undefined) { updates.push('display_order = @display_order'); params.display_order = display_order; }
    if (is_active !== undefined) { updates.push('is_active = @is_active'); params.is_active = is_active ? 1 : 0; }

    if (updates.length === 0) {
      return res.status(400).json({ error: { message: 'No fields to update.' } });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    db.prepare(`UPDATE categories SET ${updates.join(', ')} WHERE id = @id`).run(params);

    res.json({ message: 'Category updated.' });
  } catch (error) {
    console.error('[ADMIN] Category update error:', error.message);
    res.status(500).json({ error: { message: 'Failed to update category.' } });
  }
});

router.delete('/categories/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;

    // Check if category has products
    const productCount = db.prepare('SELECT COUNT(*) as count FROM products WHERE category_id = @id').get({ id }).count;
    if (productCount > 0) {
      return res.status(400).json({ error: { message: `Cannot delete category with ${productCount} products. Move or delete products first.` } });
    }

    const result = db.prepare('DELETE FROM categories WHERE id = @id').run({ id });
    if (result.changes === 0) {
      return res.status(404).json({ error: { message: 'Category not found.' } });
    }

    res.json({ message: 'Category deleted.' });
  } catch (error) {
    console.error('[ADMIN] Category delete error:', error.message);
    res.status(500).json({ error: { message: 'Failed to delete category.' } });
  }
});

// ═══════════════════════════════════════════════
// SYNC — powered by SyncEngine
// ═══════════════════════════════════════════════
const SyncEngine = require('../services/SyncEngine');

router.post('/sync/run', async (req, res) => {
  try {
    const { platform = 'all', force_refresh = false } = req.body;

    // Validate platform
    const validPlatforms = ['shopify', 'woocommerce', 'all'];
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({
        error: { message: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}` },
      });
    }

    console.log(`[ADMIN] Sync triggered for: ${platform} (force_refresh: ${force_refresh})`);

    const results = await SyncEngine.runSync(platform, {
      forceRefresh: force_refresh,
    });

    const allSucceeded = results.every(r => r.status === 'completed');
    const totalCreated = results.reduce((sum, r) => sum + (r.products_created || 0), 0);
    const totalUpdated = results.reduce((sum, r) => sum + (r.products_updated || 0), 0);
    const totalSkipped = results.reduce((sum, r) => sum + (r.products_skipped || 0), 0);
    const totalFailed = results.reduce((sum, r) => sum + (r.products_failed || 0), 0);

    res.json({
      message: allSucceeded ? 'Sync completed successfully.' : 'Sync completed with some errors.',
      summary: {
        total_created: totalCreated,
        total_updated: totalUpdated,
        total_skipped: totalSkipped,
        total_failed: totalFailed,
      },
      results,
    });
  } catch (error) {
    console.error('[ADMIN] Sync error:', error.message);
    res.status(500).json({ error: { message: `Sync failed: ${error.message}` } });
  }
});

router.get('/sync/history', (req, res) => {
  try {
    const { limit = 20, platform } = req.query;
    const logs = SyncEngine.getSyncHistory(platform || null, parseInt(limit));

    // Parse details JSON for each log
    const parsedLogs = logs.map(log => ({
      ...log,
      details: log.details ? JSON.parse(log.details) : null,
    }));

    res.json({ logs: parsedLogs });
  } catch (error) {
    console.error('[ADMIN] Sync history error:', error.message);
    res.status(500).json({ error: { message: 'Failed to load sync history.' } });
  }
});

router.get('/sync/status', (req, res) => {
  try {
    const status = SyncEngine.getSyncStatus();
    res.json({ status });
  } catch (error) {
    console.error('[ADMIN] Sync status error:', error.message);
    res.status(500).json({ error: { message: 'Failed to load sync status.' } });
  }
});

// ═══════════════════════════════════════════════
// SIMULATE SOURCE UPDATE (for Demonstration Checklist #9)
// ═══════════════════════════════════════════════
router.post('/sync/simulate-source-update', (req, res) => {
  try {
    const db = getDb();
    const { platform = 'shopify' } = req.body;

    const product = db.prepare(`
      SELECT id, title, sku, price, stock_status 
      FROM products 
      WHERE source_platform = @platform 
      ORDER BY updated_at DESC LIMIT 1
    `).get({ platform });

    if (!product) {
      return res.status(404).json({ error: { message: `No products found for ${platform}` } });
    }

    const newPrice = Math.round(product.price * 0.85);
    const newStock = product.stock_status === 'in_stock' ? 'out_of_stock' : 'in_stock';
    
    // Invalidate the price/stock so next sync reconciles
    db.prepare(`
      UPDATE products 
      SET price = @newPrice, stock_status = @newStock, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ newPrice, newStock, id: product.id });

    res.json({
      message: `Simulated source change on "${product.title}" (${product.sku}). Run sync now to observe the update!`,
      product: {
        id: product.id,
        title: product.title,
        sku: product.sku,
        previous_price: product.price,
        modified_price: newPrice,
        previous_stock: product.stock_status,
        modified_stock: newStock,
      },
    });
  } catch (error) {
    console.error('[ADMIN] Simulate error:', error.message);
    res.status(500).json({ error: { message: error.message } });
  }
});

module.exports = router;

