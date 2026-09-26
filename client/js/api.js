/**
 * ─── KICKS VAULT API Client ───
 * Ultra-fast client with ETag support, in-memory caching,
 * and resilient error fallbacks.
 */

const Api = (() => {
  const cache = new Map();

  async function request(url, options = {}) {
    const headers = options.headers || {};
    const method = options.method || 'GET';

    // Check ETag cache for GET requests
    if (method === 'GET' && cache.has(url)) {
      const cached = cache.get(url);
      if (cached.etag) {
        headers['If-None-Match'] = cached.etag;
      }
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      });

      // 304 Not Modified — return fast from memory cache
      if (response.status === 304 && cache.has(url)) {
        return cache.get(url).data;
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const etag = response.headers.get('ETag');

      if (method === 'GET') {
        cache.set(url, { data, etag, timestamp: Date.now() });
      }

      return data;
    } catch (err) {
      console.warn(`[API] Fetch failed for ${url}:`, err.message);
      // Fallback to cache if available
      if (cache.has(url)) {
        return cache.get(url).data;
      }
      throw err;
    }
  }

  return {
    async getConfig() {
      return request('/api/catalog/config');
    },

    async getCategories() {
      const res = await request('/api/catalog/categories');
      return res.categories || [];
    },

    async getProducts(params = {}) {
      const query = new URLSearchParams();
      if (params.category) query.set('category', params.category);
      if (params.search) query.set('search', params.search);
      if (params.min_price) query.set('min_price', params.min_price);
      if (params.max_price) query.set('max_price', params.max_price);
      if (params.in_stock !== undefined && params.in_stock !== '') query.set('in_stock', params.in_stock);
      if (params.featured) query.set('featured', '1');
      if (params.sort) query.set('sort', params.sort);
      if (params.page) query.set('page', params.page);
      if (params.limit) query.set('limit', params.limit || '12');

      const url = `/api/catalog/products${query.toString() ? '?' + query.toString() : ''}`;
      return request(url);
    },

    async getFeaturedProducts(limit = 8) {
      return request(`/api/catalog/products/featured?limit=${limit}`);
    },

    async getProduct(idOrSlug) {
      const res = await request(`/api/catalog/products/${encodeURIComponent(idOrSlug)}`);
      return res.product || null;
    },

    async getBatchProducts(ids) {
      if (!ids || ids.length === 0) return [];
      const res = await request('/api/catalog/products/batch', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      return res.products || [];
    },

    async getSuggestions(q) {
      if (!q || q.length < 2) return [];
      const res = await request(`/api/catalog/search/suggestions?q=${encodeURIComponent(q)}`);
      return res.suggestions || [];
    },

    clearCache() {
      cache.clear();
    },
  };
})();

window.Api = Api;
