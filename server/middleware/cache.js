/**
 * ─── Caching & Performance Middleware ───
 * 
 * Provides ETag-based conditional response caching, Cache-Control headers,
 * and X-Response-Time performance tracking for the catalog API.
 * 
 * Strategies:
 *   • ETag: MD5 hash of response body — enables 304 Not Modified responses
 *   • Cache-Control: Configurable max-age per route type (config/categories/products)
 *   • Stale-While-Revalidate: Allows serving stale cache while fetching fresh data
 *   • X-Response-Time: Microsecond-precision timing header for performance monitoring
 *   • In-memory cache: Short-lived server-side cache for hot paths (config, categories)
 */

const crypto = require('crypto');

// ═══════════════════════════════════════════════
// IN-MEMORY CACHE (lightweight, process-scoped)
// ═══════════════════════════════════════════════

const memoryCache = new Map();

const CACHE_DURATIONS = {
  config: 60 * 1000,         // 1 minute — rarely changes
  categories: 30 * 1000,     // 30 seconds — moderate change frequency
  products_list: 10 * 1000,  // 10 seconds — changes with syncs
  product_detail: 15 * 1000, // 15 seconds — individual product
};

/**
 * Get a cached value if it exists and hasn't expired.
 */
function getCached(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) {
    memoryCache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Store a value in the in-memory cache.
 */
function setCache(key, data, ttl) {
  // Prevent unbounded cache growth — limit to 500 entries
  if (memoryCache.size > 500) {
    const oldestKey = memoryCache.keys().next().value;
    memoryCache.delete(oldestKey);
  }
  memoryCache.set(key, { data, timestamp: Date.now(), ttl });
}

/**
 * Invalidate all cached entries (called after admin writes).
 */
function invalidateAll() {
  memoryCache.clear();
}

/**
 * Invalidate cache entries matching a prefix.
 */
function invalidatePrefix(prefix) {
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
}

// ═══════════════════════════════════════════════
// ETAG MIDDLEWARE
// ═══════════════════════════════════════════════

/**
 * Generate an ETag from response data.
 */
function generateETag(data) {
  const content = typeof data === 'string' ? data : JSON.stringify(data);
  return `"${crypto.createHash('md5').update(content).digest('hex')}"`;
}

/**
 * Middleware: Adds ETag and handles conditional requests (If-None-Match).
 * Wraps res.json to intercept the response body.
 */
function etagMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function (data) {
    // Don't ETag error responses or non-GET methods
    if (res.statusCode >= 400 || req.method !== 'GET') {
      return originalJson(data);
    }

    const etag = generateETag(data);
    res.set('ETag', etag);

    // Check If-None-Match header
    const ifNoneMatch = req.get('If-None-Match');
    if (ifNoneMatch && ifNoneMatch === etag) {
      return res.status(304).end();
    }

    return originalJson(data);
  };

  next();
}

// ═══════════════════════════════════════════════
// CACHE-CONTROL MIDDLEWARE
// ═══════════════════════════════════════════════

/**
 * Factory: Creates middleware that sets Cache-Control headers.
 * 
 * @param {Object} options
 * @param {number} options.maxAge - max-age in seconds (browser cache)
 * @param {number} options.sMaxAge - s-maxage in seconds (shared/CDN cache)
 * @param {boolean} options.staleWhileRevalidate - enable stale-while-revalidate
 * @param {boolean} options.isPrivate - set private vs public cache
 */
function cacheControl(options = {}) {
  const {
    maxAge = 10,
    sMaxAge = 30,
    staleWhileRevalidate = true,
    isPrivate = false,
  } = options;

  return (req, res, next) => {
    if (req.method !== 'GET') {
      res.set('Cache-Control', 'no-store');
      return next();
    }

    const directives = [
      isPrivate ? 'private' : 'public',
      `max-age=${maxAge}`,
      `s-maxage=${sMaxAge}`,
    ];

    if (staleWhileRevalidate) {
      directives.push('stale-while-revalidate=60');
    }

    res.set('Cache-Control', directives.join(', '));
    next();
  };
}

// Pre-configured cache policies
const cachePolicy = {
  /** Config endpoint — changes rarely, cache aggressively */
  config: cacheControl({ maxAge: 60, sMaxAge: 120, staleWhileRevalidate: true }),
  
  /** Categories — moderate caching */
  categories: cacheControl({ maxAge: 30, sMaxAge: 60, staleWhileRevalidate: true }),
  
  /** Product list — short cache, changes with syncs */
  productList: cacheControl({ maxAge: 10, sMaxAge: 30, staleWhileRevalidate: true }),
  
  /** Product detail — moderate cache */
  productDetail: cacheControl({ maxAge: 15, sMaxAge: 45, staleWhileRevalidate: true }),
  
  /** Admin endpoints — no caching */
  noCache: cacheControl({ maxAge: 0, sMaxAge: 0, staleWhileRevalidate: false, isPrivate: true }),
};

// ═══════════════════════════════════════════════
// RESPONSE TIME MIDDLEWARE
// ═══════════════════════════════════════════════

/**
 * Middleware: Tracks and records response time as X-Response-Time header.
 * Uses process.hrtime.bigint() for microsecond precision.
 */
function responseTime(req, res, next) {
  const start = process.hrtime.bigint();

  // Hook into response finish event
  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationNs = Number(end - start);
    const durationMs = (durationNs / 1_000_000).toFixed(2);
    
    // Set header (if headers haven't been sent yet, this is a no-op on finish)
    // We set it before sending via the writeHead hook below
  });

  // Override writeHead to inject the header before it's too late
  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = function (statusCode, ...args) {
    const end = process.hrtime.bigint();
    const durationNs = Number(end - start);
    const durationMs = (durationNs / 1_000_000).toFixed(2);
    res.setHeader('X-Response-Time', `${durationMs}ms`);
    return originalWriteHead(statusCode, ...args);
  };

  next();
}

// ═══════════════════════════════════════════════
// ADMIN CACHE INVALIDATION MIDDLEWARE
// ═══════════════════════════════════════════════

/**
 * Middleware: Invalidates memory cache after any admin write operation.
 * Applied to POST/PUT/DELETE on admin routes.
 */
function adminCacheInvalidation(req, res, next) {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const originalJson = res.json.bind(res);
    res.json = function (data) {
      // Invalidate cache after successful write
      if (res.statusCode < 400) {
        invalidateAll();
      }
      return originalJson(data);
    };
  }
  next();
}

module.exports = {
  // Middleware
  etagMiddleware,
  cacheControl,
  cachePolicy,
  responseTime,
  adminCacheInvalidation,
  
  // Cache utilities
  getCached,
  setCache,
  invalidateAll,
  invalidatePrefix,
  generateETag,
  
  // Constants
  CACHE_DURATIONS,
};
