/**
 * ─── Catalog API Routes (Phase 3: Performance-Optimized) ───
 * 
 * Public-facing, read-only endpoints for the customer catalog.
 * Designed for sub-50ms responses, minimal payloads, and intelligent caching.
 * 
 * Performance features:
 *   • ETag-based conditional responses (304 Not Modified)
 *   • In-memory server-side caching with TTL
 *   • Cache-Control headers for browser/CDN caching
 *   • Lightweight JSON projections (list view omits heavy fields)
 *   • Optional field filtering via `fields` query param
 *   • Prepared statement reuse for hot queries
 * 
 * Endpoints:
 *   GET  /api/catalog/config              → Store settings & active theme
 *   GET  /api/catalog/categories           → Active categories with product counts
 *   GET  /api/catalog/products             → Paginated product listing with filters
 *   GET  /api/catalog/products/featured    → Featured products shortcut
 *   GET  /api/catalog/products/:slug       → Full product detail with images & related
 *   POST /api/catalog/products/batch       → Batch lookup by IDs (for wishlist/inquiry)
 *   GET  /api/catalog/search/suggestions   → Lightweight search autocomplete
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const {
  etagMiddleware,
  cachePolicy,
  getCached,
  setCache,
  CACHE_DURATIONS,
} = require('../middleware/cache');

// Apply ETag middleware to all catalog routes
router.use(etagMiddleware);

// ═══════════════════════════════════════════════
// GET /config — Store configuration & active theme
// Cached aggressively: rarely changes
// ═══════════════════════════════════════════════
router.get('/config', cachePolicy.config, (req, res) => {
  try {
    // Check server-side cache first
    const cacheKey = 'catalog:config';
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const db = getDb();
    const settings = db.prepare('SELECT * FROM catalog_settings WHERE id = 1').get();
    
    const response = settings ? {
      store_name: settings.store_name,
      store_tagline: settings.store_tagline,
      active_theme: settings.active_theme,
      whatsapp_number: settings.whatsapp_number,
      whatsapp_default_message: settings.whatsapp_default_message,
      currency_symbol: settings.currency_symbol,
      currency_code: settings.currency_code,
      allow_out_of_stock_enquiry: Boolean(settings.allow_out_of_stock_enquiry),
    } : {
      store_name: 'KICKS VAULT',
      store_tagline: 'Authenticated Heat. Delivered Fresh.',
      active_theme: 'editorial_boutique',
      whatsapp_number: '+919876543210',
      whatsapp_default_message: 'Hi, I am interested in these sneakers from your catalog:',
      currency_symbol: '₹',
      currency_code: 'INR',
      allow_out_of_stock_enquiry: true,
    };

    setCache(cacheKey, response, CACHE_DURATIONS.config);
    res.json(response);
  } catch (error) {
    console.error('[CATALOG] Config error:', error.message);
    res.status(500).json({ error: { message: 'Failed to load configuration.' } });
  }
});

// ═══════════════════════════════════════════════
// GET /categories — Active categories with product counts
// Includes optional `include_empty=true` to show zero-count categories
// ═══════════════════════════════════════════════
router.get('/categories', cachePolicy.categories, (req, res) => {
  try {
    const includeEmpty = req.query.include_empty === 'true';
    const cacheKey = `catalog:categories:${includeEmpty}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const db = getDb();
    
    let query = `
      SELECT 
        c.id, c.name, c.slug, c.description, c.image_url, c.display_order,
        COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1
      WHERE c.is_active = 1
      GROUP BY c.id
    `;
    
    if (!includeEmpty) {
      query += ' HAVING product_count > 0';
    }
    
    query += ' ORDER BY c.display_order ASC';

    const categories = db.prepare(query).all();

    const response = { categories, total: categories.length };
    setCache(cacheKey, response, CACHE_DURATIONS.categories);
    res.json(response);
  } catch (error) {
    console.error('[CATALOG] Categories error:', error.message);
    res.status(500).json({ error: { message: 'Failed to load categories.' } });
  }
});

// ═══════════════════════════════════════════════
// GET /products — Paginated product listing
// 
// Query params:
//   category    — filter by category slug or ID
//   search      — full-text search on title, SKU, description
//   page        — page number (default: 1)
//   limit       — items per page (default: 24, max: 100)
//   sort        — newest | oldest | price_asc | price_desc | title_asc
//   featured    — true/1 to filter featured only
//   stock       — in_stock | out_of_stock (filter by availability)
//   price_min   — minimum price filter
//   price_max   — maximum price filter
//   source      — shopify | woocommerce | manual
//   fields      — comma-separated field whitelist for projection
// ═══════════════════════════════════════════════
router.get('/products', cachePolicy.productList, (req, res) => {
  try {
    const db = getDb();
    const {
      category,
      search,
      page = 1,
      limit = 24,
      sort = 'newest',
      featured,
      stock,
      price_min,
      price_max,
      source,
      fields,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // Build cache key from all query params
    const cacheKey = `catalog:products:${JSON.stringify(req.query)}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // ── Build WHERE clause ──
    let whereClause = 'WHERE p.is_active = 1';
    const params = {};

    // Category filter (by slug or ID)
    if (category) {
      whereClause += ' AND (c.slug = @category OR c.id = @category)';
      params.category = category;
    }

    // Search filter (title, SKU, description, colorway in metadata)
    if (search) {
      whereClause += ' AND (p.title LIKE @search OR p.sku LIKE @search OR p.short_description LIKE @search)';
      params.search = `%${search}%`;
    }

    // Featured filter
    if (featured === 'true' || featured === '1') {
      whereClause += ' AND p.is_featured = 1';
    }

    // Stock status filter
    if (stock === 'in_stock' || stock === 'out_of_stock') {
      whereClause += ' AND p.stock_status = @stock';
      params.stock = stock;
    }

    // Price range filter
    if (price_min) {
      const min = parseFloat(price_min);
      if (!isNaN(min)) {
        whereClause += ' AND p.price >= @price_min';
        params.price_min = min;
      }
    }
    if (price_max) {
      const max = parseFloat(price_max);
      if (!isNaN(max)) {
        whereClause += ' AND p.price <= @price_max';
        params.price_max = max;
      }
    }

    // Source platform filter
    if (source) {
      whereClause += ' AND p.source_platform = @source';
      params.source = source;
    }

    // ── Sort clause ──
    let orderClause;
    switch (sort) {
      case 'price_asc':
        orderClause = 'ORDER BY p.price ASC';
        break;
      case 'price_desc':
        orderClause = 'ORDER BY p.price DESC';
        break;
      case 'title_asc':
        orderClause = 'ORDER BY p.title ASC';
        break;
      case 'title_desc':
        orderClause = 'ORDER BY p.title DESC';
        break;
      case 'oldest':
        orderClause = 'ORDER BY p.created_at ASC';
        break;
      case 'newest':
      default:
        orderClause = 'ORDER BY p.created_at DESC';
        break;
    }

    // ── Count query (single indexed scan) ──
    const { total } = db.prepare(`
      SELECT COUNT(*) as total 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id
      ${whereClause}
    `).get(params);

    // ── Products query — lightweight projection ──
    // Omits full description (heavy) in list view; includes only short_description
    const products = db.prepare(`
      SELECT 
        p.id, p.title, p.slug, p.sku, p.short_description,
        p.price, p.compare_at_price, 
        p.stock_status, p.stock_quantity,
        p.is_featured, p.source_platform,
        p.category_id, c.name as category_name, c.slug as category_slug,
        p.metadata,
        pi.url as primary_image_url,
        pi.thumbnail_url as primary_thumbnail_url
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
      ${whereClause}
      ${orderClause}
      LIMIT @limit OFFSET @offset
    `).all({
      ...params,
      limit: limitNum,
      offset: offset,
    });

    // Parse metadata and apply field projection
    const allowedFields = fields ? fields.split(',').map(f => f.trim()) : null;
    
    const parsedProducts = products.map(p => {
      const product = {
        ...p,
        metadata: p.metadata ? JSON.parse(p.metadata) : null,
        is_featured: Boolean(p.is_featured),
      };

      // Apply field projection if requested
      if (allowedFields) {
        const projected = {};
        // Always include id and slug for linking
        projected.id = product.id;
        projected.slug = product.slug;
        for (const field of allowedFields) {
          if (product[field] !== undefined) {
            projected[field] = product[field];
          }
        }
        return projected;
      }

      return product;
    });

    // ── Price range stats (for frontend filter UI) ──
    const priceStats = db.prepare(`
      SELECT MIN(p.price) as min_price, MAX(p.price) as max_price
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ${whereClause.replace(' AND p.price >= @price_min', '').replace(' AND p.price <= @price_max', '')}
    `).get(
      // Remove price params for stats query
      Object.fromEntries(
        Object.entries(params).filter(([k]) => !k.startsWith('price_'))
      )
    );

    const response = {
      products: parsedProducts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: Math.ceil(total / limitNum),
        has_next: pageNum * limitNum < total,
        has_prev: pageNum > 1,
      },
      filters: {
        price_range: {
          min: priceStats?.min_price || 0,
          max: priceStats?.max_price || 0,
        },
        applied: {
          category: category || null,
          search: search || null,
          sort,
          stock: stock || null,
          price_min: price_min || null,
          price_max: price_max || null,
          featured: featured === 'true' || featured === '1' || false,
          source: source || null,
        },
      },
    };

    setCache(cacheKey, response, CACHE_DURATIONS.products_list);
    res.json(response);
  } catch (error) {
    console.error('[CATALOG] Products error:', error.message);
    res.status(500).json({ error: { message: 'Failed to load products.' } });
  }
});

// ═══════════════════════════════════════════════
// GET /products/featured — Featured products shortcut
// Returns top featured products (lightweight endpoint for hero sections)
// ═══════════════════════════════════════════════
router.get('/products/featured', cachePolicy.productList, (req, res) => {
  try {
    const { limit = 12 } = req.query;
    const limitNum = Math.min(24, Math.max(1, parseInt(limit)));

    const cacheKey = `catalog:featured:${limitNum}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const db = getDb();
    const products = db.prepare(`
      SELECT 
        p.id, p.title, p.slug, p.sku, p.short_description,
        p.price, p.compare_at_price,
        p.stock_status, p.source_platform,
        p.category_id, c.name as category_name, c.slug as category_slug,
        p.metadata,
        pi.url as primary_image_url,
        pi.thumbnail_url as primary_thumbnail_url
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
      WHERE p.is_active = 1 AND p.is_featured = 1
      ORDER BY p.updated_at DESC
      LIMIT @limit
    `).all({ limit: limitNum });

    const response = {
      products: products.map(p => ({
        ...p,
        metadata: p.metadata ? JSON.parse(p.metadata) : null,
        is_featured: true,
      })),
      total: products.length,
    };

    setCache(cacheKey, response, CACHE_DURATIONS.products_list);
    res.json(response);
  } catch (error) {
    console.error('[CATALOG] Featured error:', error.message);
    res.status(500).json({ error: { message: 'Failed to load featured products.' } });
  }
});

// ═══════════════════════════════════════════════
// GET /products/:slug — Full product detail
// Includes all images, sizes, related products
// ═══════════════════════════════════════════════
router.get('/products/:slug', cachePolicy.productDetail, (req, res) => {
  try {
    const db = getDb();
    const { slug } = req.params;

    const cacheKey = `catalog:product:${slug}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // Find product by slug or ID
    const product = db.prepare(`
      SELECT p.*, c.name as category_name, c.slug as category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE (p.slug = @slug OR p.id = @slug) AND p.is_active = 1
    `).get({ slug });

    if (!product) {
      return res.status(404).json({ error: { message: 'Product not found.' } });
    }

    // Get all images (ordered)
    const images = db.prepare(`
      SELECT id, url, thumbnail_url, alt_text, display_order, is_primary
      FROM product_images 
      WHERE product_id = @productId
      ORDER BY display_order ASC
    `).all({ productId: product.id });

    // Get related products (same category, exclude current, random selection)
    const related = db.prepare(`
      SELECT 
        p.id, p.title, p.slug, p.sku, p.price, p.compare_at_price,
        p.stock_status, p.is_featured, p.metadata, p.short_description,
        c.name as category_name,
        pi.url as primary_image_url, pi.thumbnail_url as primary_thumbnail_url
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
      WHERE p.category_id = @categoryId AND p.id != @productId AND p.is_active = 1
      ORDER BY RANDOM()
      LIMIT 6
    `).all({ categoryId: product.category_id, productId: product.id });

    // Parse metadata
    const parsedMetadata = product.metadata ? JSON.parse(product.metadata) : null;

    // Calculate discount percentage if compare_at_price exists
    let discount_percentage = null;
    if (product.compare_at_price && product.compare_at_price > product.price) {
      discount_percentage = Math.round(
        ((product.compare_at_price - product.price) / product.compare_at_price) * 100
      );
    }

    const response = {
      product: {
        id: product.id,
        title: product.title,
        slug: product.slug,
        sku: product.sku,
        description: product.description,
        short_description: product.short_description,
        price: product.price,
        compare_at_price: product.compare_at_price,
        discount_percentage,
        category_id: product.category_id,
        category_name: product.category_name,
        category_slug: product.category_slug,
        source_platform: product.source_platform,
        source_url: product.source_url,
        stock_status: product.stock_status,
        stock_quantity: product.stock_quantity,
        is_active: Boolean(product.is_active),
        is_featured: Boolean(product.is_featured),
        metadata: parsedMetadata,
        images,
        created_at: product.created_at,
        updated_at: product.updated_at,
      },
      related: related.map(r => ({
        ...r,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
        is_featured: Boolean(r.is_featured),
      })),
    };

    setCache(cacheKey, response, CACHE_DURATIONS.product_detail);
    res.json(response);
  } catch (error) {
    console.error('[CATALOG] Product detail error:', error.message);
    res.status(500).json({ error: { message: 'Failed to load product.' } });
  }
});

// ═══════════════════════════════════════════════
// POST /products/batch — Batch product lookup
// Body: { ids: ["id1", "id2", ...] }
// Used by wishlist and WhatsApp inquiry tray
// ═══════════════════════════════════════════════
router.post('/products/batch', (req, res) => {
  try {
    const db = getDb();
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: { message: 'Please provide an array of product IDs.' } });
    }

    // Limit batch size to prevent abuse
    const limitedIds = ids.slice(0, 50);
    const placeholders = limitedIds.map(() => '?').join(',');

    const products = db.prepare(`
      SELECT 
        p.id, p.title, p.slug, p.sku, p.price, p.compare_at_price,
        p.stock_status, p.stock_quantity, p.source_url, p.metadata,
        p.short_description,
        c.name as category_name,
        pi.url as primary_image_url, pi.thumbnail_url as primary_thumbnail_url
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
      WHERE p.id IN (${placeholders}) AND p.is_active = 1
    `).all(...limitedIds);

    res.json({
      products: products.map(p => ({
        ...p,
        metadata: p.metadata ? JSON.parse(p.metadata) : null,
      })),
      total: products.length,
      requested: limitedIds.length,
    });
  } catch (error) {
    console.error('[CATALOG] Batch error:', error.message);
    res.status(500).json({ error: { message: 'Failed to load products.' } });
  }
});

// ═══════════════════════════════════════════════
// GET /search/suggestions — Lightweight autocomplete
// Returns max 8 title+SKU matches for instant search
// ═══════════════════════════════════════════════
router.get('/search/suggestions', cachePolicy.productList, (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return res.json({ suggestions: [] });
    }

    const cacheKey = `catalog:search:${q.toLowerCase()}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const db = getDb();
    const suggestions = db.prepare(`
      SELECT p.id, p.title, p.slug, p.sku, p.price, 
             pi.thumbnail_url as image
      FROM products p
      LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
      WHERE p.is_active = 1 
        AND (p.title LIKE @search OR p.sku LIKE @search)
      ORDER BY 
        CASE WHEN p.title LIKE @exact THEN 0 ELSE 1 END,
        p.is_featured DESC,
        p.title ASC
      LIMIT 8
    `).all({
      search: `%${q}%`,
      exact: `${q}%`,
    });

    const response = { suggestions };
    setCache(cacheKey, response, CACHE_DURATIONS.products_list);
    res.json(response);
  } catch (error) {
    console.error('[CATALOG] Search suggestions error:', error.message);
    res.status(500).json({ error: { message: 'Failed to search.' } });
  }
});

module.exports = router;
