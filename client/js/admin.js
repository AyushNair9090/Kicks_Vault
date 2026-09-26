/**
 * ─── KICKS VAULT — Admin Dashboard Controller ───
 * Modular controller managing Security, Metrics, Products CRUD,
 * Categories CRUD, Sync Pipeline, and Catalog Settings.
 */

const Admin = (() => {
  const AUTH_TOKEN_KEY = 'kicks_vault_admin_token';
  let activeTab = 'dashboard';
  let products = [];
  let categories = [];
  let settings = {};
  let currentProductPage = 1;

  // ── Session & Auth Token Management ──
  function getToken() {
    return sessionStorage.getItem(AUTH_TOKEN_KEY) || localStorage.getItem(AUTH_TOKEN_KEY);
  }

  function setToken(token) {
    sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  }

  function clearToken() {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }

  function showAuthGate(errorMessage = '') {
    const gate = document.getElementById('admin-auth-gate');
    const errorEl = document.getElementById('auth-error-msg');
    const input = document.getElementById('admin-password-input');
    if (gate) gate.classList.remove('hidden');
    if (errorEl) {
      if (errorMessage) {
        errorEl.textContent = errorMessage;
        errorEl.style.display = 'block';
      } else {
        errorEl.style.display = 'none';
      }
    }
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 150);
    }
  }

  function hideAuthGate() {
    const gate = document.getElementById('admin-auth-gate');
    const errorEl = document.getElementById('auth-error-msg');
    if (gate) gate.classList.add('hidden');
    if (errorEl) errorEl.style.display = 'none';
  }

  async function checkAuth() {
    const token = getToken();
    if (!token) {
      showAuthGate();
      return false;
    }

    try {
      const res = await fetch('/api/admin/auth/verify', {
        headers: { 'x-admin-token': token },
      });
      const data = await res.json();
      if (data.authenticated) {
        hideAuthGate();
        return true;
      }
    } catch (e) {
      console.warn('[Admin Auth] Verification error:', e);
    }

    clearToken();
    showAuthGate();
    return false;
  }

  async function login() {
    const input = document.getElementById('admin-password-input');
    const errorEl = document.getElementById('auth-error-msg');
    const btnText = document.getElementById('login-btn-text');
    const spinner = document.getElementById('login-spinner');
    const submitBtn = document.getElementById('admin-login-btn');

    const password = input?.value.trim();
    if (!password) return;

    if (btnText) btnText.style.display = 'none';
    if (spinner) spinner.style.display = 'inline-block';
    if (submitBtn) submitBtn.disabled = true;
    if (errorEl) errorEl.style.display = 'none';

    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (res.ok && data.token) {
        setToken(data.token);
        hideAuthGate();
        toast('Vault unlocked. Welcome to Admin Panel!', 'success');
        await loadDashboard();
        await loadCategories();
        await loadSettings();
      } else {
        if (errorEl) {
          errorEl.textContent = data.error?.message || 'Invalid password. Please try again.';
          errorEl.style.display = 'block';
        }
        if (input) {
          input.focus();
          input.select();
        }
      }
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = 'Connection error. Could not authenticate.';
        errorEl.style.display = 'block';
      }
    } finally {
      if (btnText) btnText.style.display = 'inline-block';
      if (spinner) spinner.style.display = 'none';
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function logout() {
    const token = getToken();
    try {
      if (token) {
        await fetch('/api/admin/auth/logout', {
          method: 'POST',
          headers: { 'x-admin-token': token },
        });
      }
    } catch (e) {}

    clearToken();
    showAuthGate('You have been logged out.');
    toast('Logged out of Admin Panel.', 'info');
  }

  function togglePasswordVisibility() {
    const input = document.getElementById('admin-password-input');
    const btn = document.getElementById('toggle-pwd-btn');
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      if (btn) btn.textContent = '🙈';
    } else {
      input.type = 'password';
      if (btn) btn.textContent = '👁️';
    }
  }

  // ── Authenticated API Fetch Wrapper ──
  async function adminFetch(url, options = {}) {
    const token = getToken();
    const headers = {
      ...(options.headers || {}),
      'x-admin-token': token || '',
    };
    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      clearToken();
      showAuthGate('Session expired or unauthorized. Please enter your password.');
      throw new Error('Unauthorized');
    }
    return res;
  }

  async function init() {
    bindTabs();
    bindModals();
    bindSyncButtons();
    bindSettingsForm();

    const isAuthenticated = await checkAuth();
    if (isAuthenticated) {
      await loadDashboard();
      await loadCategories();
      await loadSettings();
    }
  }

  // ── Toast Utility ──
  function toast(message, type = 'info') {
    const container = document.getElementById('admin-toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.className = 'admin-toast';
    t.style.borderColor = type === 'error' ? 'var(--status-red)' : type === 'success' ? 'var(--neon-green)' : 'var(--admin-border-strong)';
    t.textContent = message;
    container.appendChild(t);
    setTimeout(() => {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 3000);
  }

  // ── Tab Navigation ──
  function bindTabs() {
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        switchTab(tab);
      });
    });
  }

  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('.tab-view').forEach(view => {
      view.classList.toggle('active', view.id === `tab-${tab}`);
    });

    if (tab === 'dashboard') loadDashboard();
    if (tab === 'products') loadProducts();
    if (tab === 'categories') loadCategories();
    if (tab === 'sync') loadSyncHistory();
    if (tab === 'settings') loadSettings();
  }

  // ── 1. DASHBOARD METRICS ──
  async function loadDashboard() {
    try {
      const res = await adminFetch('/api/admin/dashboard');
      const data = await res.json();
      const m = data.metrics || {};

      document.getElementById('metric-total-products').textContent = m.total_products || 0;
      document.getElementById('metric-total-categories').textContent = m.total_categories || 0;
      document.getElementById('metric-out-of-stock').textContent = m.out_of_stock || 0;
      document.getElementById('metric-featured').textContent = m.featured_products || 0;
      
      const lastSync = data.last_sync;
      document.getElementById('metric-last-sync').textContent = lastSync 
        ? `${new Date(lastSync.completed_at || lastSync.started_at).toLocaleTimeString()} (${lastSync.status})` 
        : 'Never';

      document.getElementById('metric-source-shopify').textContent = `${m.sources?.shopify || 0} items`;
      document.getElementById('metric-source-woo').textContent = `${m.sources?.woocommerce || 0} items`;
      document.getElementById('metric-source-manual').textContent = `${m.sources?.manual || 0} items`;
      
      document.getElementById('topbar-active-theme-badge').textContent = data.active_theme === 'editorial_boutique' ? 'Editorial' : 'Hype Matrix';
    } catch (err) {
      console.error('[Admin] Dashboard error:', err);
    }
  }

  // ── 2. PRODUCT MANAGEMENT ──
  async function loadProducts(page = 1) {
    currentProductPage = page;
    const search = document.getElementById('product-search')?.value.trim() || '';
    const category = document.getElementById('product-category-filter')?.value || '';
    const source = document.getElementById('product-source-filter')?.value || '';

    const tbody = document.getElementById('products-table-body');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 32px;"><span class="spinner"></span> Loading products...</td></tr>`;

    try {
      const query = new URLSearchParams({ page, limit: 15 });
      if (search) query.set('search', search);
      if (category) query.set('category', category);
      if (source) query.set('source', source);

      const res = await adminFetch(`/api/admin/products?${query.toString()}`);
      const data = await res.json();
      products = data.products || [];
      const pagination = data.pagination || {};

      renderProductsTable(products);
      renderProductPagination(pagination);
    } catch (err) {
      console.error('[Admin] Products error:', err);
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--status-red);">Failed to load products.</td></tr>`;
    }
  }

  function renderProductsTable(items) {
    const tbody = document.getElementById('products-table-body');
    if (!tbody) return;

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 32px;">No products found matching filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map(p => {
      const isOutOfStock = p.stock_status === 'out_of_stock';
      const statusBadge = `
        <span class="badge-status ${isOutOfStock ? 'out-of-stock' : 'in-stock'}" data-id="${p.id}" data-status="${p.stock_status}" style="cursor: pointer;" title="Click to toggle availability">
          ● ${isOutOfStock ? 'Out of Stock' : 'In Stock'}
        </span>
      `;

      const sourceBadge = `<span class="badge-source ${p.source_platform}">${p.source_platform}</span>`;

      return `
        <tr data-id="${p.id}">
          <td>
            <div style="display: flex; align-items: center; gap: 12px;">
              <img src="${p.primary_image_url || 'https://images.unsplash.com/photo-1552346154-21d32810aba3?w=100'}" class="table-thumb" alt="${p.title}" />
              <div>
                <div style="font-weight: 700; color: #fff; line-height: 1.3;">${p.title}</div>
                <div style="font-size: 0.75rem; color: var(--text-sub);">${p.category_name || 'Sneakers'}</div>
              </div>
            </div>
          </td>
          <td style="font-family: var(--font-mono); font-size: 0.8125rem; color: var(--text-muted);">${p.sku}</td>
          <td>
            <div class="inline-price-edit" data-id="${p.id}">
              <span class="price-val">₹${Number(p.price).toLocaleString()}</span>
              <input type="number" class="price-input" value="${p.price}" style="display: none;" />
              <button class="btn-edit-price" title="Quick Edit Price">✎</button>
            </div>
          </td>
          <td>${statusBadge}</td>
          <td>${sourceBadge}</td>
          <td>${p.stock_quantity || 0} units</td>
          <td style="text-align: right;">
            <button class="btn btn-secondary btn-sm btn-edit-product" data-id="${p.id}">Edit</button>
            <button class="btn btn-danger btn-sm btn-delete-product" data-id="${p.id}" data-title="${p.title}" style="margin-left: 4px;">Delete</button>
          </td>
        </tr>
      `;
    }).join('');

    // Bind inline price editing
    tbody.querySelectorAll('.inline-price-edit').forEach(container => {
      const id = container.getAttribute('data-id');
      const valSpan = container.querySelector('.price-val');
      const input = container.querySelector('.price-input');
      const editBtn = container.querySelector('.btn-edit-price');

      editBtn.addEventListener('click', () => {
        valSpan.style.display = 'none';
        editBtn.style.display = 'none';
        input.style.display = 'inline-block';
        input.focus();
        input.select();
      });

      input.addEventListener('blur', async () => {
        const newPrice = parseFloat(input.value);
        if (!isNaN(newPrice) && newPrice >= 0) {
          try {
            const res = await adminFetch(`/api/admin/products/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ price: newPrice }),
            });
            if (res.ok) {
              valSpan.textContent = `₹${newPrice.toLocaleString()}`;
              toast(`Updated price to ₹${newPrice.toLocaleString()}`, 'success');
            } else {
              toast('Failed to save price', 'error');
            }
          } catch (e) {
            toast('Network error updating price', 'error');
          }
        }
        valSpan.style.display = 'inline';
        editBtn.style.display = 'inline';
        input.style.display = 'none';
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          input.blur();
        }
      });
    });

    // Bind Stock Status toggle
    tbody.querySelectorAll('.badge-status').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const currentStatus = btn.getAttribute('data-status');
        const nextStatus = currentStatus === 'in_stock' ? 'out_of_stock' : 'in_stock';

        try {
          const res = await adminFetch(`/api/admin/products/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stock_status: nextStatus }),
          });
          if (res.ok) {
            btn.setAttribute('data-status', nextStatus);
            btn.className = `badge-status ${nextStatus === 'in_stock' ? 'in-stock' : 'out-of-stock'}`;
            btn.textContent = `● ${nextStatus === 'in_stock' ? 'In Stock' : 'Out of Stock'}`;
            toast(`Updated availability to ${nextStatus === 'in_stock' ? 'In Stock' : 'Out of Stock'}`, 'success');
          }
        } catch (e) {
          toast('Failed to toggle stock status', 'error');
        }
      });
    });

    // Bind Edit modal
    tbody.querySelectorAll('.btn-edit-product').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const prod = products.find(p => p.id === id);
        if (prod) openEditProductModal(prod);
      });
    });

    // Bind Delete modal
    tbody.querySelectorAll('.btn-delete-product').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const title = btn.getAttribute('data-title');
        confirmDeleteProduct(id, title);
      });
    });
  }

  function renderProductPagination(p) {
    const el = document.getElementById('products-pagination');
    if (!el) return;
    if (!p.total_pages || p.total_pages <= 1) {
      el.innerHTML = '';
      return;
    }

    el.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; font-size: 0.8125rem; color: var(--text-muted);">
        <div>Showing page ${p.page} of ${p.total_pages} (${p.total} total items)</div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary btn-sm" id="prod-prev-btn" ${p.page <= 1 ? 'disabled' : ''}>‹ Prev</button>
          <button class="btn btn-secondary btn-sm" id="prod-next-btn" ${p.page >= p.total_pages ? 'disabled' : ''}>Next ›</button>
        </div>
      </div>
    `;

    document.getElementById('prod-prev-btn')?.addEventListener('click', () => loadProducts(p.page - 1));
    document.getElementById('prod-next-btn')?.addEventListener('click', () => loadProducts(p.page + 1));
  }

  // ── 3. CATEGORIES MANAGEMENT ──
  async function loadCategories() {
    try {
      const res = await adminFetch('/api/admin/categories');
      const data = await res.json();
      categories = data.categories || [];

      // Populate filter dropdowns
      const filterSelect = document.getElementById('product-category-filter');
      const modalSelect = document.getElementById('form-product-category');
      const editModalSelect = document.getElementById('edit-product-category');

      const optionsHtml = '<option value="">All Categories</option>' + categories.map(c => `
        <option value="${c.id}">${c.name} (${c.product_count || 0})</option>
      `).join('');

      if (filterSelect) filterSelect.innerHTML = optionsHtml;
      if (modalSelect) modalSelect.innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      if (editModalSelect) editModalSelect.innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

      // Populate categories table
      const catTable = document.getElementById('categories-table-body');
      if (catTable) {
        catTable.innerHTML = categories.map(c => `
          <tr>
            <td style="font-weight: 700; color: #fff;">${c.name}</td>
            <td style="font-family: var(--font-mono); color: var(--text-sub);">${c.slug}</td>
            <td>${c.product_count || 0} sneakers</td>
            <td>Order: ${c.display_order}</td>
            <td style="text-align: right;">
              <button class="btn btn-danger btn-sm btn-delete-cat" data-id="${c.id}" data-count="${c.product_count || 0}">Delete</button>
            </td>
          </tr>
        `).join('');

        catTable.querySelectorAll('.btn-delete-cat').forEach(btn => {
          btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            const count = parseInt(btn.getAttribute('data-count'));
            if (count > 0) {
              toast(`Cannot delete category with ${count} active products.`, 'error');
              return;
            }
            if (confirm('Are you sure you want to delete this category?')) {
              try {
                const res = await adminFetch(`/api/admin/categories/${id}`, { method: 'DELETE' });
                if (res.ok) {
                  toast('Category deleted', 'success');
                  loadCategories();
                }
              } catch (e) {
                toast('Delete failed', 'error');
              }
            }
          });
        });
      }
    } catch (err) {
      console.error('[Admin] Categories error:', err);
    }
  }

  // ── 4. SYNC PIPELINE & HISTORY ──
  function bindSyncButtons() {
    const runBtn = document.getElementById('btn-run-sync-all');
    const shopifyBtn = document.getElementById('btn-sync-shopify');
    const wooBtn = document.getElementById('btn-sync-woo');
    const simulateBtn = document.getElementById('btn-simulate-source-change');

    async function triggerSync(platform) {
      const banner = document.getElementById('sync-progress-banner');
      if (banner) banner.style.display = 'flex';
      toast(`Initiating ${platform.toUpperCase()} sync pipeline...`, 'info');

      try {
        const res = await adminFetch('/api/admin/sync/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform, force_refresh: false }),
        });
        const data = await res.json();

        if (res.ok) {
          const s = data.summary || {};
          toast(`Sync complete! Created: ${s.total_created}, Updated: ${s.total_updated}, Skipped: ${s.total_skipped}`, 'success');
          loadDashboard();
          loadSyncHistory();
        } else {
          toast(data.error?.message || 'Sync failed', 'error');
        }
      } catch (err) {
        toast(`Sync connection error: ${err.message}`, 'error');
      } finally {
        if (banner) banner.style.display = 'none';
      }
    }

    runBtn?.addEventListener('click', () => triggerSync('all'));
    shopifyBtn?.addEventListener('click', () => triggerSync('shopify'));
    wooBtn?.addEventListener('click', () => triggerSync('woocommerce'));

    // Mutate source product & verify sync detection
    simulateBtn?.addEventListener('click', async () => {
      try {
        const res = await adminFetch('/api/admin/sync/simulate-source-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: 'shopify' }),
        });
        const data = await res.json();
        if (res.ok) {
          toast(data.message, 'info');
          alert(`✅ Source Change Simulated!\n\nProduct: "${data.product.title}" (${data.product.sku})\nOriginal Price: ₹${data.product.previous_price}\nTemporary Price: ₹${data.product.modified_price}\n\nNow click "Sync Shopify" above to observe the SyncEngine automatically detect and reconcile this update!`);
          loadProducts();
        }
      } catch (e) {
        toast('Simulation failed', 'error');
      }
    });
  }

  async function loadSyncHistory() {
    const tbody = document.getElementById('sync-history-table-body');
    if (!tbody) return;

    try {
      const res = await adminFetch('/api/admin/sync/history?limit=15');
      const data = await res.json();
      const logs = data.logs || [];

      if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No synchronization history recorded yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = logs.map(l => {
        const statusColor = l.status === 'completed' ? 'var(--neon-green)' : 'var(--status-red)';
        const date = new Date(l.completed_at || l.started_at).toLocaleString();

        return `
          <tr>
            <td style="font-family: var(--font-mono); font-size: 0.75rem;">${date}</td>
            <td><span class="badge-source ${l.platform}">${l.platform}</span></td>
            <td><strong style="color: ${statusColor};">● ${l.status}</strong></td>
            <td style="color: var(--neon-green); font-weight: 700;">+${l.products_created}</td>
            <td style="color: var(--brand-blue); font-weight: 700;">↻ ${l.products_updated}</td>
            <td style="color: var(--text-muted);">${l.products_skipped}</td>
            <td style="font-family: var(--font-mono); font-size: 0.75rem;">${l.details?.duration_ms ? l.details.duration_ms + 'ms' : 'N/A'}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('[Admin] Sync history error:', err);
    }
  }

  // ── 5. STORE SETTINGS & THEME TOGGLE ──
  async function loadSettings() {
    try {
      const res = await adminFetch('/api/admin/settings');
      const data = await res.json();
      settings = data.settings || {};

      document.getElementById('setting-store-name').value = settings.store_name || '';
      document.getElementById('setting-store-tagline').value = settings.store_tagline || '';
      document.getElementById('setting-whatsapp-number').value = settings.whatsapp_number || '';
      document.getElementById('setting-whatsapp-message').value = settings.whatsapp_default_message || '';
      document.getElementById('setting-currency-symbol').value = settings.currency_symbol || '₹';

      // Theme cards
      const activeTheme = settings.active_theme || 'editorial_boutique';
      document.querySelectorAll('.theme-card').forEach(card => {
        const theme = card.getAttribute('data-theme');
        card.classList.toggle('active', theme === activeTheme);
      });
    } catch (err) {
      console.error('[Admin] Settings error:', err);
    }
  }

  function bindSettingsForm() {
    // Theme card clicks
    document.querySelectorAll('.theme-card').forEach(card => {
      card.addEventListener('click', async () => {
        const theme = card.getAttribute('data-theme');
        document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');

        // Immediately persist to backend
        try {
          const res = await adminFetch('/api/admin/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active_theme: theme }),
          });
          if (res.ok) {
            toast(`Switched catalog design to ${theme === 'editorial_boutique' ? 'Editorial Boutique' : 'Hype Matrix'}!`, 'success');
            document.getElementById('topbar-active-theme-badge').textContent = theme === 'editorial_boutique' ? 'Editorial' : 'Hype Matrix';
          }
        } catch (e) {
          toast('Failed to update design template', 'error');
        }
      });
    });

    // Save full settings form
    document.getElementById('form-settings')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        store_name: document.getElementById('setting-store-name').value.trim(),
        store_tagline: document.getElementById('setting-store-tagline').value.trim(),
        whatsapp_number: document.getElementById('setting-whatsapp-number').value.trim(),
        whatsapp_default_message: document.getElementById('setting-whatsapp-message').value.trim(),
        currency_symbol: document.getElementById('setting-currency-symbol').value.trim(),
      };

      try {
        const res = await adminFetch('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          toast('Store settings updated successfully', 'success');
        }
      } catch (err) {
        toast('Failed to save settings', 'error');
      }
    });
  }

  // ── Modals & CRUD Actions ──
  function bindModals() {
    // Add product button
    document.getElementById('btn-add-product')?.addEventListener('click', () => {
      document.getElementById('form-add-product')?.reset();
      document.getElementById('modal-add-product')?.classList.add('active');
    });

    // Add category button
    document.getElementById('btn-add-category')?.addEventListener('click', () => {
      document.getElementById('form-add-category')?.reset();
      document.getElementById('modal-add-category')?.classList.add('active');
    });

    // Close buttons on all modals
    document.querySelectorAll('.admin-modal-backdrop .modal-close, .admin-modal-backdrop .btn-close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-modal-backdrop').forEach(m => m.classList.remove('active'));
      });
    });

    // Form: Create Product
    document.getElementById('form-add-product')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('form-product-title').value.trim();
      const sku = document.getElementById('form-product-sku').value.trim();
      const price = parseFloat(document.getElementById('form-product-price').value);
      const comparePrice = parseFloat(document.getElementById('form-product-compare').value) || null;
      const categoryId = document.getElementById('form-product-category').value;
      const stockStatus = document.getElementById('form-product-stock').value;
      const imageUrl = document.getElementById('form-product-image').value.trim();
      const sizesStr = document.getElementById('form-product-sizes').value.trim();
      const desc = document.getElementById('form-product-desc').value.trim();

      const body = {
        title,
        sku,
        price,
        compare_at_price: comparePrice,
        category_id: categoryId,
        stock_status: stockStatus,
        description: desc,
        short_description: desc.substring(0, 100),
        images: imageUrl ? [{ url: imageUrl, thumbnail_url: imageUrl, is_primary: true }] : [],
        metadata: {
          sizes: sizesStr.split(',').map(s => s.trim()).filter(Boolean),
          brand: 'VIP DROP',
        },
      };

      try {
        const res = await adminFetch('/api/admin/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          toast(`Created sneaker "${title}"`, 'success');
          document.getElementById('modal-add-product')?.classList.remove('active');
          loadProducts(1);
          loadDashboard();
        } else {
          const err = await res.json();
          toast(err.error?.message || 'Failed to create product', 'error');
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    // Form: Create Category
    document.getElementById('form-add-category')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('form-category-name').value.trim();
      const desc = document.getElementById('form-category-desc').value.trim();
      const order = parseInt(document.getElementById('form-category-order').value) || 0;

      try {
        const res = await adminFetch('/api/admin/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description: desc, display_order: order }),
        });
        if (res.ok) {
          toast(`Created category "${name}"`, 'success');
          document.getElementById('modal-add-category')?.classList.remove('active');
          loadCategories();
        }
      } catch (err) {
        toast('Failed to create category', 'error');
      }
    });

    // Search & Filter event bindings
    document.getElementById('product-search')?.addEventListener('input', () => {
      clearTimeout(window._prodSearchTimer);
      window._prodSearchTimer = setTimeout(() => loadProducts(1), 300);
    });
    document.getElementById('product-category-filter')?.addEventListener('change', () => loadProducts(1));
    document.getElementById('product-source-filter')?.addEventListener('change', () => loadProducts(1));
  }

  function openEditProductModal(p) {
    const modal = document.getElementById('modal-edit-product');
    if (!modal) return;

    document.getElementById('edit-product-id').value = p.id;
    document.getElementById('edit-product-title').value = p.title || '';
    document.getElementById('edit-product-sku').value = p.sku || '';
    document.getElementById('edit-product-price').value = p.price || '';
    document.getElementById('edit-product-compare').value = p.compare_at_price || '';
    document.getElementById('edit-product-category').value = p.category_id || '';
    document.getElementById('edit-product-stock').value = p.stock_status || 'in_stock';
    document.getElementById('edit-product-desc').value = p.description || '';

    modal.classList.add('active');

    const form = document.getElementById('form-edit-product');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const id = document.getElementById('edit-product-id').value;
      const body = {
        title: document.getElementById('edit-product-title').value.trim(),
        sku: document.getElementById('edit-product-sku').value.trim(),
        price: parseFloat(document.getElementById('edit-product-price').value),
        compare_at_price: parseFloat(document.getElementById('edit-product-compare').value) || null,
        category_id: document.getElementById('edit-product-category').value,
        stock_status: document.getElementById('edit-product-stock').value,
        description: document.getElementById('edit-product-desc').value.trim(),
      };

      try {
        const res = await adminFetch(`/api/admin/products/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          toast(`Updated "${body.title}"`, 'success');
          modal.classList.remove('active');
          loadProducts(currentProductPage);
        }
      } catch (err) {
        toast('Failed to update product', 'error');
      }
    };
  }

  function confirmDeleteProduct(id, title) {
    if (confirm(`Are you sure you want to permanently delete "${title}"?`)) {
      adminFetch(`/api/admin/products/${id}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(() => {
          toast(`Deleted "${title}"`, 'info');
          loadProducts(currentProductPage);
          loadDashboard();
        })
        .catch(() => toast('Delete failed', 'error'));
    }
  }

  return {
    init,
    toast,
    login,
    logout,
    togglePasswordVisibility,
    switchTab,
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  Admin.init();
});
