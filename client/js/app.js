/**
 * ─── KICKS VAULT Main Application Controller ───
 * Glues together APIs, Stores, Components, and Themes.
 * Supports deep linking, dynamic filtering, sorting, pagination, and theme switching.
 */

const App = (() => {
  let state = {
    category: '',
    search: '',
    sort: 'newest',
    in_stock: '',
    featured: '',
    page: 1,
    limit: 12,
  };

  let elProductGrid, elCategoryNav, elResultCount, elPagination;
  let elSortBtn, elSortMenu, elSortLabel;
  let elThemeSwitchBtn, elThemeLabel;

  async function init() {
    // Cache DOM references
    elProductGrid = document.getElementById('product-grid');
    elCategoryNav = document.getElementById('category-nav-inner');
    elResultCount = document.getElementById('result-count');
    elPagination = document.getElementById('pagination');
    elSortBtn = document.getElementById('sort-btn');
    elSortMenu = document.getElementById('sort-menu');
    elSortLabel = document.getElementById('sort-label');
    elThemeSwitchBtn = document.getElementById('theme-switch-btn');
    elThemeLabel = document.getElementById('theme-label');

    // Parse URL search params
    const params = new URLSearchParams(window.location.search);
    if (params.has('category')) state.category = params.get('category');
    if (params.has('search')) state.search = params.get('search');
    if (params.has('sort')) state.sort = params.get('sort');
    if (params.has('in_stock')) state.in_stock = params.get('in_stock');
    if (params.has('featured')) state.featured = params.get('featured');
    if (params.has('page')) state.page = parseInt(params.get('page')) || 1;

    // Initialize sub-components
    Lightbox.init();
    ProductModal.init();
    EnquiryTray.init();
    WishlistDrawer.init();

    Search.init((q) => {
      state.search = q;
      state.page = 1;
      updateUrlAndFetch();
    });
    if (state.search) Search.setValue(state.search);

    // Initialize theme
    initTheme();

    // Bind UI controls
    bindToolbarEvents();

    // Fetch initial config & categories
    try {
      const config = await Api.getConfig();
      Store.setConfig(config);
      updateStoreBranding(config);
    } catch (e) {
      console.warn('[App] Could not load config:', e);
    }

    // Load categories & products
    await loadCategories();
    await loadProducts();

    // Handle deep linked product (?p=slug)
    const productParam = params.get('p');
    if (productParam) {
      ProductModal.open(productParam);
    }

    // Re-render cards when wishlist or tray changes to keep buttons in sync
    Store.on('wishlist:change', updateCardActions);
    Store.on('tray:change', updateCardActions);
  }

  // ── Theme Management ──
  function initTheme() {
    const currentTheme = Store.getTheme();
    document.documentElement.setAttribute('data-theme', currentTheme);
    updateThemeButton(currentTheme);

    elThemeSwitchBtn?.addEventListener('click', () => {
      const nextTheme = Store.toggleTheme();
      updateThemeButton(nextTheme);
      showToast(`Switched to ${nextTheme === 'editorial_boutique' ? 'Editorial Boutique' : 'Hype Matrix'} design`);
    });

    Store.on('theme:change', (theme) => {
      updateThemeButton(theme);
    });
  }

  function updateThemeButton(theme) {
    if (!elThemeLabel) return;
    if (theme === 'editorial_boutique') {
      elThemeLabel.innerHTML = '✨ <strong>Editorial</strong> / Hype';
    } else {
      elThemeLabel.innerHTML = '⚡ Editorial / <strong>Hype</strong>';
    }
  }

  function updateStoreBranding(config) {
    const logoEl = document.getElementById('store-logo');
    const taglineEl = document.getElementById('store-tagline');
    if (logoEl && config.store_name) {
      if (config.store_name.includes('|')) {
        const [brand, sub] = config.store_name.split('|').map(s => s.trim());
        logoEl.innerHTML = `<span class="brand-title">${brand}</span><span class="brand-sub"> | ${sub}</span>`;
      } else {
        logoEl.textContent = config.store_name;
      }
    }
    if (taglineEl && config.store_tagline) taglineEl.textContent = config.store_tagline;
  }

  // ── Categories Navigation ──
  async function loadCategories() {
    if (!elCategoryNav) return;

    try {
      const categories = await Api.getCategories();
      const totalCount = categories.reduce((sum, c) => sum + (c.product_count || 0), 0);

      let html = `
        <button class="category-pill ${!state.category ? 'active' : ''}" data-slug="">
          <span>All Silhouettes</span>
          <span class="count">${totalCount}</span>
        </button>
      `;

      categories.forEach(cat => {
        const isActive = state.category === cat.slug;
        html += `
          <button class="category-pill ${isActive ? 'active' : ''}" data-slug="${cat.slug}">
            <span>${cat.name}</span>
            <span class="count">${cat.product_count || 0}</span>
          </button>
        `;
      });

      elCategoryNav.innerHTML = html;

      // Bind category pill clicks
      elCategoryNav.querySelectorAll('.category-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          elCategoryNav.querySelectorAll('.category-pill').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.category = btn.getAttribute('data-slug');
          state.page = 1;
          updateUrlAndFetch();
        });
      });
    } catch (err) {
      console.error('[App] Failed to load categories:', err);
    }
  }

  // ── Products Fetching & Rendering ──
  async function loadProducts() {
    if (!elProductGrid) return;

    // Render skeleton placeholders
    renderSkeletons(state.limit);

    try {
      const data = await Api.getProducts(state);
      const products = data.products || [];
      const pagination = data.pagination || { total: products.length, page: 1, total_pages: 1 };

      if (elResultCount) {
        elResultCount.textContent = `Showing ${products.length} of ${pagination.total} sneakers`;
      }

      if (products.length === 0) {
        renderEmptyState();
        if (elPagination) elPagination.innerHTML = '';
        return;
      }

      renderProductGrid(products);
      renderPagination(pagination);
    } catch (err) {
      console.error('[App] Failed to load products:', err);
      elProductGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="icon">⚠️</div>
          <h3>Failed to load sneakers</h3>
          <p>Please check your connection and try again.</p>
        </div>
      `;
    }
  }

  function renderSkeletons(count = 12) {
    elProductGrid.innerHTML = Array.from({ length: count }).map(() => `
      <div class="skeleton-card skeleton">
        <div class="skeleton-image skeleton"></div>
        <div class="skeleton-line skeleton" style="margin-top: 14px;"></div>
        <div class="skeleton-line short skeleton"></div>
        <div class="skeleton-line price skeleton" style="margin-bottom: 16px;"></div>
      </div>
    `).join('');
  }

  function renderEmptyState() {
    elProductGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="icon">👟</div>
        <h3>No sneakers found</h3>
        <p>Try clearing your search query or adjusting your filters.</p>
        <button class="filter-chip" id="btn-reset-filters" style="margin-top: 16px; display: inline-flex;">
          Reset All Filters
        </button>
      </div>
    `;
    document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
      state.category = '';
      state.search = '';
      state.in_stock = '';
      state.featured = '';
      state.page = 1;
      Search.setValue('');
      // Reset active pill
      elCategoryNav?.querySelectorAll('.category-pill').forEach((b, i) => b.classList.toggle('active', i === 0));
      updateUrlAndFetch();
    });
  }

  function renderProductGrid(products) {
    elProductGrid.innerHTML = products.map(product => {
      const isWishlisted = Store.wishlist.has(product.id);
      const isInTray = Store.tray.has(product.id);
      const priceFormatted = Store.formatPrice(product.price);
      const compareFormatted = product.compare_at_price ? Store.formatPrice(product.compare_at_price) : '';
      const discount = product.discount_percentage ? `${product.discount_percentage}% OFF` : '';
      const isOutOfStock = product.stock_status === 'out_of_stock';
      const isFeatured = product.is_featured;

      const primaryImg = product.primary_image_url || 'https://images.unsplash.com/photo-1552346154-21d32810aba3?w=600';
      const secondaryImg = product.metadata?.secondary_image_url || null;
      const sizes = product.metadata?.sizes?.slice(0, 4) || ['US 8', 'US 9', 'US 10', 'US 11'];

      return `
        <article class="product-card ${isFeatured ? 'featured' : ''}" data-id="${product.id}" data-slug="${product.slug || product.id}">
          <!-- Multi-Select Checkbox for Quick Tray (Hype theme or direct click) -->
          <div class="product-card-select ${isInTray ? 'checked' : ''}" data-id="${product.id}" title="Select for WhatsApp inquiry">
            ✓
          </div>

          <!-- Product Image & Badges -->
          <div class="product-card-image">
            <img src="${primaryImg}" alt="${product.title}" loading="lazy" class="primary-img" />
            ${secondaryImg ? `<img src="${secondaryImg}" alt="${product.title} angle 2" loading="lazy" class="secondary-img" />` : ''}
            
            ${isOutOfStock ? `
              <span class="product-card-badge out-of-stock has-select">Out of Stock</span>
            ` : isFeatured ? `
              <span class="product-card-badge has-select">Featured</span>
            ` : ''}

            <button class="product-card-wishlist ${isWishlisted ? 'active' : ''}" data-id="${product.id}" title="Save to wishlist" aria-label="Save to wishlist">
              ${isWishlisted ? '♥' : '♡'}
            </button>
          </div>

          <!-- Product Info -->
          <div class="product-card-info">
            <div class="product-card-sku">${product.sku || 'VERIFIED SNEAKER'}</div>
            <h3 class="product-card-title truncate-2">${product.title}</h3>

            <div class="product-card-price">
              <span class="current">${priceFormatted}</span>
              ${compareFormatted ? `<span class="original">${compareFormatted}</span>` : ''}
              ${discount ? `<span class="discount">${discount}</span>` : ''}
            </div>

            <!-- Size Preview Tags -->
            <div class="product-card-sizes">
              ${sizes.map(s => `<span class="size-tag">${s}</span>`).join('')}
              ${(product.metadata?.sizes?.length || 0) > 4 ? `<span class="size-tag">+${product.metadata.sizes.length - 4}</span>` : ''}
            </div>

            <!-- Quick WhatsApp Enquiry Button -->
            <button class="product-card-enquiry-btn ${isInTray ? 'active' : ''}" data-id="${product.id}">
              <span>${isInTray ? '✓ In Enquiry Tray' : '💬 Enquire via WhatsApp'}</span>
            </button>
          </div>
        </article>
      `;
    }).join('');

    bindProductCardEvents(products);
  }

  function bindProductCardEvents(products) {
    const productMap = new Map(products.map(p => [p.id, p]));

    // Card click opens modal (unless clicking specific buttons)
    elProductGrid.querySelectorAll('.product-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('.product-card-select')) return;
        const slug = card.getAttribute('data-slug');
        ProductModal.open(slug);
      });
    });

    // Wishlist button click
    elProductGrid.querySelectorAll('.product-card-wishlist').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const prod = productMap.get(id);
        if (!prod) return;
        const isNowIn = Store.wishlist.toggle(prod);
        btn.classList.toggle('active', isNowIn);
        btn.textContent = isNowIn ? '♥' : '♡';
        showToast(isNowIn ? `Saved "${prod.title}" to wishlist` : `Removed from wishlist`);
      });
    });

    // Multi-select checkbox click
    elProductGrid.querySelectorAll('.product-card-select').forEach(chk => {
      chk.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = chk.getAttribute('data-id');
        const prod = productMap.get(id);
        if (!prod) return;

        if (Store.tray.has(id)) {
          Store.tray.remove(id);
          chk.classList.remove('checked');
          showToast(`Removed from enquiry tray`);
        } else {
          Store.tray.add(prod);
          chk.classList.add('checked');
          showToast(`Added to WhatsApp enquiry tray`);
        }
      });
    });

    // Quick Enquiry button click
    elProductGrid.querySelectorAll('.product-card-enquiry-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const prod = productMap.get(id);
        if (!prod) return;

        if (Store.tray.has(id)) {
          // If already in tray, open WhatsApp directly with current tray
          const url = Store.buildWhatsAppUrl();
          if (url) window.open(url, '_blank');
        } else {
          // Add to tray with instant feedback
          Store.tray.add(prod);
          btn.classList.add('active');
          btn.innerHTML = '<span>✓ In Enquiry Tray</span>';
          showToast(`Added "${prod.title}" to enquiry tray`);
        }
      });
    });
  }

  function updateCardActions() {
    if (!elProductGrid) return;
    elProductGrid.querySelectorAll('.product-card').forEach(card => {
      const id = card.getAttribute('data-id');
      const isWishlisted = Store.wishlist.has(id);
      const isInTray = Store.tray.has(id);

      const wlBtn = card.querySelector('.product-card-wishlist');
      if (wlBtn) {
        wlBtn.classList.toggle('active', isWishlisted);
        wlBtn.textContent = isWishlisted ? '♥' : '♡';
      }

      const chk = card.querySelector('.product-card-select');
      if (chk) chk.classList.toggle('checked', isInTray);

      const enqBtn = card.querySelector('.product-card-enquiry-btn');
      if (enqBtn) {
        enqBtn.classList.toggle('active', isInTray);
        enqBtn.innerHTML = `<span>${isInTray ? '✓ In Enquiry Tray' : '💬 Enquire via WhatsApp'}</span>`;
      }
    });
  }

  // ── Pagination ──
  function renderPagination(pagination) {
    if (!elPagination) return;
    const { page, total_pages } = pagination;

    if (total_pages <= 1) {
      elPagination.innerHTML = '';
      return;
    }

    let html = `
      <button class="page-prev" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">‹ Prev</button>
    `;

    for (let p = 1; p <= total_pages; p++) {
      if (p === 1 || p === total_pages || (p >= page - 1 && p <= page + 1)) {
        html += `<button class="page-num ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`;
      } else if (p === page - 2 || p === page + 2) {
        html += `<span style="padding: 0 4px; opacity: 0.4;">...</span>`;
      }
    }

    html += `
      <button class="page-next" ${page >= total_pages ? 'disabled' : ''} aria-label="Next page">Next ›</button>
    `;

    elPagination.innerHTML = html;

    // Bind page buttons
    elPagination.querySelectorAll('.page-num').forEach(btn => {
      btn.addEventListener('click', () => {
        state.page = parseInt(btn.getAttribute('data-page'));
        updateUrlAndFetch();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    elPagination.querySelector('.page-prev')?.addEventListener('click', () => {
      if (state.page > 1) {
        state.page--;
        updateUrlAndFetch();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    elPagination.querySelector('.page-next')?.addEventListener('click', () => {
      if (state.page < total_pages) {
        state.page++;
        updateUrlAndFetch();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  // ── Toolbar & Filter Events ──
  function bindToolbarEvents() {
    // Sort dropdown toggle
    elSortBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      elSortMenu?.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
      if (elSortMenu && !elSortBtn.contains(e.target) && !elSortMenu.contains(e.target)) {
        elSortMenu.classList.remove('active');
      }
    });

    elSortMenu?.querySelectorAll('.sort-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const val = opt.getAttribute('data-sort');
        const text = opt.textContent;
        state.sort = val;
        state.page = 1;
        if (elSortLabel) elSortLabel.textContent = text;
        elSortMenu.querySelectorAll('.sort-option').forEach(o => o.classList.toggle('active', o === opt));
        elSortMenu.classList.remove('active');
        updateUrlAndFetch();
      });
    });

    // In-Stock toggle filter chip
    const inStockChip = document.getElementById('filter-instock');
    inStockChip?.addEventListener('click', () => {
      const active = inStockChip.classList.toggle('active');
      state.in_stock = active ? '1' : '';
      state.page = 1;
      updateUrlAndFetch();
    });

    // Featured toggle filter chip
    const featuredChip = document.getElementById('filter-featured');
    featuredChip?.addEventListener('click', () => {
      const active = featuredChip.classList.toggle('active');
      state.featured = active ? '1' : '';
      state.page = 1;
      updateUrlAndFetch();
    });
  }

  function updateUrlAndFetch() {
    const url = new URL(window.location);
    if (state.category) url.searchParams.set('category', state.category);
    else url.searchParams.delete('category');

    if (state.search) url.searchParams.set('search', state.search);
    else url.searchParams.delete('search');

    if (state.sort && state.sort !== 'newest') url.searchParams.set('sort', state.sort);
    else url.searchParams.delete('sort');

    if (state.in_stock) url.searchParams.set('in_stock', state.in_stock);
    else url.searchParams.delete('in_stock');

    if (state.featured) url.searchParams.set('featured', state.featured);
    else url.searchParams.delete('featured');

    if (state.page > 1) url.searchParams.set('page', state.page);
    else url.searchParams.delete('page');

    window.history.pushState({}, '', url);
    loadProducts();
  }

  // ── Toast Notifications ──
  function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 2800);
  }

  return { init, showToast };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

window.App = App;
