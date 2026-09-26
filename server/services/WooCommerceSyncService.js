/**
 * ─── WooCommerceSyncService ───
 * 
 * Connects directly to the WooCommerce REST API v3 to import products.
 * Uses real API credentials (WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET)
 * from .env.
 * 
 * Features:
 *   • Live WooCommerce REST API v3 integration
 *   • Full pagination support
 *   • Normalizes WooCommerce product schema → internal catalog schema
 *   • Deterministic MD5 hash calculation for atomic diffing
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════

function getWooConfig() {
  let storeUrl = process.env.WOO_STORE_URL || '';
  let consumerKey = process.env.WOO_CONSUMER_KEY || '';
  let consumerSecret = process.env.WOO_CONSUMER_SECRET || '';

  try {
    const envPath = path.resolve(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const urlMatch = content.match(/^WOO_STORE_URL\s*=\s*(.+)$/m);
      const keyMatch = content.match(/^WOO_CONSUMER_KEY\s*=\s*(.+)$/m);
      const secretMatch = content.match(/^WOO_CONSUMER_SECRET\s*=\s*(.+)$/m);
      if (urlMatch) storeUrl = urlMatch[1].trim().replace(/^["']|["']$/g, '');
      if (keyMatch) consumerKey = keyMatch[1].trim().replace(/^["']|["']$/g, '');
      if (secretMatch) consumerSecret = secretMatch[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch (err) {}

  return { storeUrl, consumerKey, consumerSecret };
}

function isConfigured() {
  const config = getWooConfig();
  return Boolean(
    config.storeUrl &&
    config.consumerKey &&
    config.consumerSecret &&
    !config.storeUrl.includes('your-store') &&
    !config.consumerKey.includes('your_consumer') &&
    !config.consumerSecret.includes('your_consumer')
  );
}

// ═══════════════════════════════════════════════
// WOOCOMMERCE API CLIENT
// ═══════════════════════════════════════════════

/**
 * Fetch all products from WooCommerce REST API v3 with pagination.
 */
async function fetchFromWooCommerceAPI() {
  const config = getWooConfig();
  const baseUrl = config.storeUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/wp-json/wc/v3/products`;

  const allProducts = [];
  let page = 1;
  const perPage = 100;

  console.log(`[WOOCOMMERCE] Fetching products from ${baseUrl}...`);

  while (true) {
    const url = `${endpoint}?page=${page}&per_page=${perPage}&status=publish&consumer_key=${encodeURIComponent(config.consumerKey)}&consumer_secret=${encodeURIComponent(config.consumerSecret)}`;

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404 && page > 1) {
        break; // End of pagination
      }
      const errorText = await response.text();
      throw new Error(`WooCommerce API error ${response.status}: ${errorText}`);
    }

    const products = await response.json();
    if (!Array.isArray(products) || products.length === 0) {
      break;
    }

    allProducts.push(...products);

    const totalPages = parseInt(response.headers.get('x-wp-totalpages') || '1', 10);
    if (page >= totalPages) break;
    page++;
  }

  console.log(`[WOOCOMMERCE] Fetched ${allProducts.length} products from live WooCommerce API.`);
  return allProducts;
}

/**
 * Transform a WooCommerce product into internal normalized schema.
 */
function normalizeWooProduct(wooProduct, categoryMap) {
  const images = (wooProduct.images || []).map((img, idx) => ({
    url: img.src,
    thumbnail_url: img.src,
    alt_text: img.alt || `${wooProduct.name} - View ${idx + 1}`,
    display_order: idx,
    is_primary: idx === 0,
  }));

  const categories = (wooProduct.categories || []).map(c => c.name.toLowerCase()).join(' ');
  const tags = (wooProduct.tags || []).map(t => t.name.toLowerCase()).join(' ');
  let categoryId = 'cat-runners';

  for (const [key, keywords] of Object.entries(categoryMap)) {
    if (keywords.some(kw => categories.includes(kw) || tags.includes(kw))) {
      categoryId = key;
      break;
    }
  }

  const price = Math.round(parseFloat(wooProduct.price || wooProduct.regular_price || '0'));
  const regularPrice = wooProduct.regular_price
    ? Math.round(parseFloat(wooProduct.regular_price))
    : null;
  const compareAtPrice = (regularPrice && regularPrice > price) ? regularPrice : null;

  const sizeAttr = (wooProduct.attributes || []).find(a =>
    a.name.toLowerCase().includes('size')
  );
  const sizes = sizeAttr ? sizeAttr.options : ['US 8', 'US 9', 'US 10', 'US 11'];

  const colorAttr = (wooProduct.attributes || []).find(a =>
    a.name.toLowerCase().includes('color')
  );
  const colorway = colorAttr ? colorAttr.options.join('/') : 'Standard Edition';

  const metadata = {
    colorway: colorway,
    sizes: sizes,
    material: 'Premium Materials',
    release_year: new Date(wooProduct.date_created || Date.now()).getFullYear(),
    condition: 'Brand New / Deadstock',
    woo_permalink: wooProduct.permalink,
  };

  const description = (wooProduct.description || wooProduct.short_description || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const stockStatus = wooProduct.stock_status === 'instock' ? 'in_stock' : 'out_of_stock';
  const stockQuantity = wooProduct.stock_quantity !== null ? wooProduct.stock_quantity : 15;

  return {
    source_platform: 'woocommerce',
    source_id: `woo-${wooProduct.id}`,
    source_url: wooProduct.permalink || '',
    title: wooProduct.name,
    sku: wooProduct.sku || `WOO-${wooProduct.id}`,
    description: description,
    short_description: description.substring(0, 120) + (description.length > 120 ? '...' : ''),
    price: price || 9999,
    compare_at_price: compareAtPrice,
    category_id: categoryId,
    stock_status: stockStatus,
    stock_quantity: stockQuantity,
    is_featured: wooProduct.featured ? 1 : 0,
    metadata: JSON.stringify(metadata),
    images: images,
    _hash: generateProductHash({
      title: wooProduct.name,
      price: price,
      stock: stockQuantity,
      updated_at: wooProduct.date_modified || wooProduct.date_created,
    }),
    updated_at: wooProduct.date_modified || new Date().toISOString(),
  };
}

/**
 * Generate a deterministic hash for change detection.
 */
function generateProductHash(data) {
  return crypto
    .createHash('md5')
    .update(JSON.stringify(data))
    .digest('hex');
}

// ═══════════════════════════════════════════════
// CATEGORY MAPPING
// ═══════════════════════════════════════════════
const CATEGORY_MAP = {
  'cat-retro-high': ['retro high', 'high-top', 'jordan 1 high', 'jordan 4', 'jordan 3', 'jordan 11', 'dunk high'],
  'cat-low-top': ['low-top', 'low top', 'dunk low', 'air force 1', 'samba', 'stan smith', 'cortez', '550'],
  'cat-runners': ['running', 'runner', 'lifestyle', 'air max', 'ultraboost', 'gel-kayano', 'vomero', '990', '2002r'],
  'cat-skate': ['skate', 'canvas', 'sb dunk', 'old skool', 'sk8-hi', 'chuck taylor', 'blazer', 'campus'],
  'cat-collabs': ['collab', 'grail', 'travis scott', 'off-white', 'sacai', 'union', 'a ma maniere', 'bape'],
  'cat-basketball': ['basketball', 'lebron', 'kobe', 'kd', 'harden', 'book 1', 'ja 2'],
  'cat-boots': ['boot', 'outdoor', 'acg', 'timberland', 'gore-tex', 'utility'],
  'cat-apparel': ['apparel', 'streetwear', 'hoodie', 'jogger', 'tee', 'jacket', 'fleece'],
};

// ═══════════════════════════════════════════════
// MAIN FETCH METHOD — STRICT REAL API ONLY
// ═══════════════════════════════════════════════

/**
 * Fetch products from WooCommerce using real credentials.
 * Zero dummy fixture fallback.
 * 
 * @returns {Promise<{ products: Array, source: string, count: number }>}
 */
async function fetchProducts() {
  if (!isConfigured()) {
    throw new Error('WooCommerce API is not configured in .env. Real API credentials required.');
  }

  console.log('[WOOCOMMERCE] Fetching live catalog from WooCommerce API...');
  const wooProducts = await fetchFromWooCommerceAPI();
  const normalized = wooProducts.map(p => normalizeWooProduct(p, CATEGORY_MAP));

  return {
    products: normalized,
    source: 'api',
    count: normalized.length,
  };
}

module.exports = {
  fetchProducts,
  isConfigured,
  generateProductHash,
  CATEGORY_MAP,
};
