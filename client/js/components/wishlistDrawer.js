/**
 * ─── Wishlist Slide-Over Drawer ───
 * Displays saved sneakers with 1-click batch WhatsApp enquiry,
 * quick add to enquiry tray, and seamless drawer interactions.
 */

const WishlistDrawer = (() => {
  let drawerEl, backdropEl, bodyEl, countLabel, enquireAllBtn, clearBtn;
  let fabBadge, headerBadge;

  function init() {
    backdropEl = document.getElementById('wishlist-backdrop');
    drawerEl = document.getElementById('wishlist-drawer');
    if (!drawerEl) return;

    bodyEl = drawerEl.querySelector('.wishlist-drawer-body');
    countLabel = drawerEl.querySelector('#wishlist-count-label');
    enquireAllBtn = drawerEl.querySelector('#wishlist-enquire-all');
    clearBtn = drawerEl.querySelector('#wishlist-clear');

    fabBadge = document.getElementById('wishlist-fab-badge');
    headerBadge = document.getElementById('header-wishlist-badge');

    // Trigger buttons
    document.getElementById('wishlist-fab')?.addEventListener('click', open);
    document.getElementById('header-wishlist-btn')?.addEventListener('click', open);
    drawerEl.querySelector('.modal-close')?.addEventListener('click', close);
    backdropEl?.addEventListener('click', close);

    // ESC to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawerEl.classList.contains('active')) {
        close();
      }
    });

    // Enquire all in wishlist
    enquireAllBtn?.addEventListener('click', () => {
      const items = Store.wishlist.getAll();
      if (items.length === 0) return;
      const url = Store.buildWhatsAppUrl(items);
      if (url) window.open(url, '_blank');
    });

    // Clear wishlist
    clearBtn?.addEventListener('click', () => {
      Store.wishlist.clear();
      App.showToast('Wishlist cleared');
    });

    // Subscribe to store updates
    Store.on('wishlist:change', (state) => {
      updateBadges(state.count);
      if (drawerEl.classList.contains('active')) {
        renderItems(state.items);
      }
    });

    // Initial badge update
    updateBadges(Store.wishlist.count());
  }

  function updateBadges(count) {
    if (fabBadge) {
      fabBadge.textContent = count;
      fabBadge.style.display = count > 0 ? 'flex' : 'none';
    }
    if (headerBadge) {
      headerBadge.textContent = count;
      headerBadge.style.display = count > 0 ? 'flex' : 'none';
    }
    if (countLabel) {
      countLabel.textContent = `(${count})`;
    }
  }

  function open() {
    if (!drawerEl) return;
    renderItems(Store.wishlist.getAll());
    backdropEl.classList.add('active');
    drawerEl.classList.add('active');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('drawer-open');
  }

  function close() {
    if (!drawerEl) return;
    backdropEl.classList.remove('active');
    drawerEl.classList.remove('active');
    document.body.style.overflow = '';
    document.body.classList.remove('drawer-open');
  }

  function renderItems(items) {
    if (!bodyEl) return;

    if (items.length === 0) {
      bodyEl.innerHTML = `
        <div class="empty-state" style="padding: var(--space-8) var(--space-4);">
          <div class="icon">♡</div>
          <h3 style="font-size: var(--font-base);">Your wishlist is empty</h3>
          <p style="font-size: var(--font-xs);">Tap the heart icon on any sneaker to save it for later.</p>
        </div>
      `;
      if (enquireAllBtn) enquireAllBtn.style.display = 'none';
      if (clearBtn) clearBtn.style.display = 'none';
      return;
    }

    if (enquireAllBtn) enquireAllBtn.style.display = 'flex';
    if (clearBtn) clearBtn.style.display = 'block';

    bodyEl.innerHTML = items.map(item => `
      <div class="wishlist-item" data-id="${item.id}" data-slug="${item.slug || item.id}">
        <img src="${item.primary_image_url || 'https://images.unsplash.com/photo-1552346154-21d32810aba3?w=100'}" alt="${item.title}" />
        <div class="wishlist-item-info">
          <div class="wishlist-item-title">${item.title}</div>
          <div class="wishlist-item-sku">SKU: ${item.sku || 'N/A'}</div>
          <div class="wishlist-item-price">${Store.formatPrice(item.price)}</div>
        </div>
        <div class="wishlist-item-actions">
          <button class="wishlist-item-remove" data-id="${item.id}" title="Remove from wishlist">✕</button>
          <button class="wishlist-item-add-tray" data-id="${item.id}">+ Enquire</button>
        </div>
      </div>
    `).join('');

    // Bind item click to open modal
    bodyEl.querySelectorAll('.wishlist-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const slug = el.getAttribute('data-slug');
        close();
        ProductModal.open(slug);
      });
    });

    // Bind remove buttons
    bodyEl.querySelectorAll('.wishlist-item-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        Store.wishlist.toggle({ id });
      });
    });

    // Bind add to enquiry tray buttons
    bodyEl.querySelectorAll('.wishlist-item-add-tray').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const item = items.find(it => it.id === id);
        if (item) {
          Store.tray.add(item);
          App.showToast(`Added ${item.title} to enquiry tray`);
        }
      });
    });
  }

  return { init, open, close };
})();

window.WishlistDrawer = WishlistDrawer;
