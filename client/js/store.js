/**
 * ─── KICKS VAULT State & Storage Store ───
 * Reactive event-driven store with LocalStorage persistence.
 * Zero login required for Wishlist & WhatsApp enquiry selection.
 */

const Store = (() => {
  const listeners = new Map();

  function emit(event, data) {
    if (listeners.has(event)) {
      listeners.get(event).forEach(cb => {
        try { cb(data); } catch (e) { console.error(`[Store Event Error ${event}]:`, e); }
      });
    }
  }

  function on(event, callback) {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    listeners.get(event).add(callback);
    return () => listeners.get(event).delete(callback);
  }

  // ── Config & Settings ──
  let config = {
    store_name: 'KICKS VAULT',
    store_tagline: 'Authenticated Heat. Delivered Fresh.',
    whatsapp_number: '+919876543210',
    whatsapp_default_message: 'Hi, I am interested in these sneakers from your catalog:',
    currency_symbol: '₹',
    currency_code: 'INR',
    allow_out_of_stock_enquiry: true,
  };

  // ── Theme State ──
  const THEME_KEY = 'kicks_vault_theme';
  let activeTheme = localStorage.getItem(THEME_KEY) || 'editorial_boutique';

  function setTheme(theme) {
    activeTheme = theme;
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
    emit('theme:change', theme);
  }

  function toggleTheme() {
    const nextTheme = activeTheme === 'editorial_boutique' ? 'hype_matrix' : 'editorial_boutique';
    setTheme(nextTheme);
    return nextTheme;
  }

  // ── Wishlist State ──
  const WISHLIST_KEY = 'kicks_vault_wishlist';
  let wishlist = new Map(); // id -> item summary

  try {
    const saved = localStorage.getItem(WISHLIST_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        parsed.forEach(item => {
          if (item && item.id) wishlist.set(item.id, item);
        });
      }
    }
  } catch (e) {
    console.warn('[Store] Failed to load wishlist from storage:', e);
  }

  function saveWishlist() {
    try {
      localStorage.setItem(WISHLIST_KEY, JSON.stringify(Array.from(wishlist.values())));
    } catch (e) {
      console.warn('[Store] Failed to save wishlist:', e);
    }
    emit('wishlist:change', {
      items: Array.from(wishlist.values()),
      count: wishlist.size,
    });
  }

  function toggleWishlist(product) {
    if (!product || !product.id) return false;
    if (wishlist.has(product.id)) {
      wishlist.delete(product.id);
      saveWishlist();
      return false; // removed
    } else {
      wishlist.set(product.id, {
        id: product.id,
        title: product.title,
        slug: product.slug,
        sku: product.sku,
        price: product.price,
        compare_at_price: product.compare_at_price,
        primary_image_url: product.primary_image_url || (product.images && product.images[0]?.url),
        category_name: product.category_name,
        addedAt: Date.now(),
      });
      saveWishlist();
      return true; // added
    }
  }

  function isInWishlist(productId) {
    return wishlist.has(productId);
  }

  function getWishlistItems() {
    return Array.from(wishlist.values());
  }

  function clearWishlist() {
    wishlist.clear();
    saveWishlist();
  }

  // ── WhatsApp Enquiry Tray State ──
  const TRAY_KEY = 'kicks_vault_enquiry_tray';
  let enquiryTray = new Map(); // id -> { product, selectedSize }

  try {
    const savedTray = localStorage.getItem(TRAY_KEY);
    if (savedTray) {
      const parsed = JSON.parse(savedTray);
      if (Array.isArray(parsed)) {
        parsed.forEach(item => {
          if (item && item.id) enquiryTray.set(item.id, item);
        });
      }
    }
  } catch (e) {
    console.warn('[Store] Failed to load enquiry tray from storage:', e);
  }

  function saveTray() {
    try {
      localStorage.setItem(TRAY_KEY, JSON.stringify(Array.from(enquiryTray.values())));
    } catch (e) {
      console.warn('[Store] Failed to save tray:', e);
    }
    emit('tray:change', {
      items: Array.from(enquiryTray.values()),
      count: enquiryTray.size,
    });
  }

  function addToTray(product, selectedSize = null) {
    if (!product || !product.id) return false;
    enquiryTray.set(product.id, {
      id: product.id,
      title: product.title,
      slug: product.slug,
      sku: product.sku,
      price: product.price,
      image: product.primary_thumbnail_url || product.primary_image_url || (product.images && product.images[0]?.url),
      selectedSize: selectedSize || (product.metadata?.sizes ? product.metadata.sizes[0] : null) || 'Standard',
      addedAt: Date.now(),
    });
    saveTray();
    return true;
  }

  function removeFromTray(productId) {
    if (enquiryTray.has(productId)) {
      enquiryTray.delete(productId);
      saveTray();
      return true;
    }
    return false;
  }

  function isInTray(productId) {
    return enquiryTray.has(productId);
  }

  function getTrayItems() {
    return Array.from(enquiryTray.values());
  }

  function clearTray() {
    enquiryTray.clear();
    saveTray();
  }

  // ── WhatsApp Message Formatter ──
  function buildWhatsAppUrl(items = null, singleProduct = null, singleSize = null) {
    const number = (config.whatsapp_number || '+919876543210').replace(/[^0-9]/g, '');
    const origin = window.location.origin;

    let message = '';
    const sym = config.currency_symbol || '₹';

    if (singleProduct) {
      // 1-Click single product enquiry
      const sizeStr = singleSize ? ` (Size: ${singleSize})` : '';
      message = `Hi, I am interested in this sneaker from your catalog:\n\n` +
        `• ${singleProduct.title}${sizeStr}\n` +
        `  SKU: ${singleProduct.sku || 'N/A'}\n` +
        `  Price: ${sym}${Number(singleProduct.price).toLocaleString()}\n` +
        `  Link: ${origin}/?p=${encodeURIComponent(singleProduct.slug || singleProduct.id)}\n\n` +
        `Please share availability and shipping details.`;
    } else {
      // Multi-sneaker batch enquiry
      const list = items || Array.from(enquiryTray.values());
      if (list.length === 0) return null;

      message = `Hi, I am interested in the following sneakers from your catalog:\n\n`;
      list.forEach((item, index) => {
        const sizeInfo = item.selectedSize ? `\n   - Size: ${item.selectedSize}` : '';
        message += `${index + 1}. ${item.title}\n` +
          `   - SKU: ${item.sku || 'N/A'}\n` +
          `   - Price: ${sym}${Number(item.price).toLocaleString()}` +
          `${sizeInfo}\n` +
          `   - Link: ${origin}/?p=${encodeURIComponent(item.slug || item.id)}\n\n`;
      });
      message += `Please share availability and shipping details.`;
    }

    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  }

  function formatPrice(amount) {
    if (amount === undefined || amount === null) return '';
    const num = Number(amount);
    return `${config.currency_symbol || '₹'}${num.toLocaleString()}`;
  }

  function setConfig(newConfig) {
    config = { ...config, ...newConfig };
    if (!localStorage.getItem(THEME_KEY) && newConfig.active_theme) {
      setTheme(newConfig.active_theme);
    }
    emit('config:change', config);
  }

  function getConfig() {
    return config;
  }

  return {
    on,
    emit,
    getConfig,
    setConfig,
    getTheme: () => activeTheme,
    setTheme,
    toggleTheme,
    wishlist: {
      toggle: toggleWishlist,
      has: isInWishlist,
      getAll: getWishlistItems,
      count: () => wishlist.size,
      clear: clearWishlist,
    },
    tray: {
      add: addToTray,
      remove: removeFromTray,
      has: isInTray,
      getAll: getTrayItems,
      count: () => enquiryTray.size,
      clear: clearTray,
    },
    buildWhatsAppUrl,
    formatPrice,
  };
})();

window.Store = Store;
