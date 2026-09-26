/**
 * ─── Product Detail Modal / Mobile Bottom Sheet ───
 * Responsive modal with multi-angle image carousel, interactive size selector,
 * direct 1-click WhatsApp enquiry, and add-to-tray actions.
 */

const ProductModal = (() => {
  let modalEl, backdropEl, containerEl;
  let currentProduct = null;
  let selectedSize = null;
  let currentImageIndex = 0;

  function init() {
    backdropEl = document.getElementById('product-modal-backdrop');
    modalEl = document.getElementById('product-modal');
    if (!modalEl) return;

    containerEl = modalEl.querySelector('.modal-container');

    // Close on backdrop click
    backdropEl?.addEventListener('click', close);

    // Close on close button
    modalEl.querySelector('.modal-close')?.addEventListener('click', close);

    // ESC to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalEl.classList.contains('active')) {
        close();
      }
    });

    // Mobile swipe down to close
    let touchStartY = 0;
    modalEl.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    modalEl.addEventListener('touchend', (e) => {
      const touchEndY = e.changedTouches[0].clientY;
      if (touchEndY - touchStartY > 120 && modalEl.scrollTop <= 10) {
        close();
      }
    }, { passive: true });
  }

  async function open(slugOrId) {
    if (!modalEl) return;

    // Show loading skeleton inside modal
    renderSkeleton();
    backdropEl.classList.add('active');
    modalEl.classList.add('active');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('modal-open');

    try {
      const product = await Api.getProduct(slugOrId);
      if (!product) {
        App.showToast('Product not found');
        close();
        return;
      }
      currentProduct = product;
      renderProduct(product);

      // Update URL query without full reload
      const url = new URL(window.location);
      url.searchParams.set('p', product.slug || product.id);
      window.history.replaceState({}, '', url);
    } catch (err) {
      console.error('[ProductModal] Error loading product:', err);
      App.showToast('Failed to load product details');
      close();
    }
  }

  function close() {
    if (!modalEl) return;
    backdropEl.classList.remove('active');
    modalEl.classList.remove('active');
    document.body.style.overflow = '';
    document.body.classList.remove('modal-open');
    currentProduct = null;
    selectedSize = null;

    // Remove ?p= from URL
    const url = new URL(window.location);
    if (url.searchParams.has('p')) {
      url.searchParams.delete('p');
      window.history.replaceState({}, '', url);
    }
  }

  function renderSkeleton() {
    if (!containerEl) return;
    containerEl.innerHTML = `
      <div class="modal-media-col" style="padding: var(--space-8); display: flex; align-items: center; justify-content: center;">
        <div class="skeleton" style="width: 100%; aspect-ratio: 1/1; border-radius: var(--radius-lg);"></div>
      </div>
      <div class="modal-info-col">
        <div class="skeleton" style="width: 30%; height: 16px;"></div>
        <div class="skeleton" style="width: 80%; height: 32px; margin-top: 8px;"></div>
        <div class="skeleton" style="width: 40%; height: 24px; margin-top: 8px;"></div>
        <div class="skeleton" style="width: 100%; height: 60px; margin-top: 16px;"></div>
        <div class="skeleton" style="width: 100%; height: 48px; margin-top: 16px;"></div>
      </div>
    `;
  }

  function renderProduct(product) {
    if (!containerEl) return;
    currentImageIndex = 0;

    // Available images
    const images = (product.images && product.images.length > 0)
      ? product.images
      : [{ url: product.primary_image_url || 'https://images.unsplash.com/photo-1552346154-21d32810aba3?w=800&auto=format&fit=crop&q=80', is_primary: true }];

    // Available sizes
    const sizes = product.metadata?.sizes || ['US 7.5', 'US 8', 'US 8.5', 'US 9', 'US 9.5', 'US 10', 'US 10.5', 'US 11'];
    selectedSize = sizes[0] || 'Standard';

    const isWishlisted = Store.wishlist.has(product.id);
    const isInTray = Store.tray.has(product.id);
    const priceFormatted = Store.formatPrice(product.price);
    const compareFormatted = product.compare_at_price ? Store.formatPrice(product.compare_at_price) : '';
    const discount = product.discount_percentage ? `${product.discount_percentage}% OFF` : '';

    const isOutOfStock = product.stock_status === 'out_of_stock';
    const brand = product.metadata?.brand || 'AUTHENTIC DROP';
    const colorway = product.metadata?.colorway || 'Original';
    const releaseDate = product.metadata?.release_date || '2023 - 2024';

    containerEl.innerHTML = `
      <!-- Media Column -->
      <div class="modal-media-col">
        <div class="modal-carousel" id="modal-carousel">
          <div class="modal-carousel-track" id="modal-carousel-track">
            ${images.map((img, i) => `
              <img src="${img.url}" alt="${product.title} angle ${i + 1}" data-index="${i}" class="modal-carousel-img" />
            `).join('')}
          </div>
          ${images.length > 1 ? `
            <button class="modal-carousel-nav prev" id="modal-prev" aria-label="Previous image">‹</button>
            <button class="modal-carousel-nav next" id="modal-next" aria-label="Next image">›</button>
            <div class="modal-carousel-dots" id="modal-dots">
              ${images.map((_, i) => `
                <div class="modal-carousel-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></div>
              `).join('')}
            </div>
          ` : ''}
        </div>

        ${images.length > 1 ? `
          <div class="modal-thumbs">
            ${images.map((img, i) => `
              <button class="modal-thumb-btn ${i === 0 ? 'active' : ''}" data-index="${i}">
                <img src="${img.thumbnail_url || img.url}" alt="Thumbnail ${i + 1}" />
              </button>
            `).join('')}
          </div>
        ` : ''}
      </div>

      <!-- Information Column -->
      <div class="modal-info-col">
        <div class="modal-brand">${brand}</div>
        
        <h2 class="modal-product-title">${product.title}</h2>

        <div class="modal-meta-row">
          <span class="modal-sku-tag">SKU: ${product.sku || 'N/A'}</span>
          <span class="modal-auth-badge">✓ Authenticated Heat</span>
          <span class="product-card-stock ${isOutOfStock ? 'out-of-stock' : 'in-stock'}">
            ${isOutOfStock ? '● Out of Stock (Custom Order)' : '● Ready to Ship'}
          </span>
        </div>

        <div class="modal-price-wrap">
          <div class="modal-product-price">${priceFormatted}</div>
          ${compareFormatted ? `<div class="modal-original-price">${compareFormatted}</div>` : ''}
          ${discount ? `<div class="modal-discount-badge">${discount}</div>` : ''}
        </div>

        ${product.short_description ? `<p style="font-size: var(--font-sm); opacity: 0.8; line-height: 1.6;">${product.short_description}</p>` : ''}

        <!-- Size Picker -->
        <div>
          <div class="modal-section-label">
            <span>Select Size</span>
            <span style="opacity: 0.6; text-transform: none; font-weight: 500;">Size Guide: US Men</span>
          </div>
          <div class="modal-size-grid" id="modal-size-grid" style="margin-top: 8px;">
            ${sizes.map((size, i) => `
              <button class="modal-size-btn ${i === 0 ? 'selected' : ''}" data-size="${size}">${size}</button>
            `).join('')}
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="modal-actions">
          <button class="modal-btn-wa" id="modal-wa-btn">
            <span>💬 Enquire via WhatsApp (Size: <strong id="modal-selected-size-label">${selectedSize}</strong>)</span>
          </button>
          
          <div class="modal-btn-row">
            <button class="modal-btn-tray" id="modal-tray-btn">
              <span>${isInTray ? '✓ In WhatsApp Tray' : '➕ Add to Multi-Item Tray'}</span>
            </button>
            
            <button class="modal-btn-wishlist ${isWishlisted ? 'active' : ''}" id="modal-wishlist-btn" title="Wishlist">
              ${isWishlisted ? '♥' : '♡'}
            </button>
          </div>
        </div>

        <!-- Product Specs Table -->
        <table class="modal-specs-table">
          <tbody>
            <tr><td>Silhouette</td><td>${product.category_name || 'Sneakers'}</td></tr>
            <tr><td>Colorway</td><td>${colorway}</td></tr>
            <tr><td>Release Year</td><td>${releaseDate}</td></tr>
            <tr><td>Packaging</td><td>Original Box & Accessories</td></tr>
            <tr><td>Verification</td><td>Multi-point physical authentication check</td></tr>
          </tbody>
        </table>
      </div>
    `;

    bindModalEvents(images);
  }

  function bindModalEvents(images) {
    const track = containerEl.querySelector('#modal-carousel-track');
    const dots = containerEl.querySelectorAll('.modal-carousel-dot');
    const thumbs = containerEl.querySelectorAll('.modal-thumb-btn');

    function goToImage(index) {
      currentImageIndex = (index + images.length) % images.length;
      if (track) {
        track.style.transform = `translateX(-${currentImageIndex * 100}%)`;
      }
      dots.forEach((dot, i) => dot.classList.toggle('active', i === currentImageIndex));
      thumbs.forEach((th, i) => th.classList.toggle('active', i === currentImageIndex));
    }

    // Carousel buttons
    containerEl.querySelector('#modal-prev')?.addEventListener('click', (e) => {
      e.stopPropagation();
      goToImage(currentImageIndex - 1);
    });
    containerEl.querySelector('#modal-next')?.addEventListener('click', (e) => {
      e.stopPropagation();
      goToImage(currentImageIndex + 1);
    });

    // Thumbnails & dots click
    thumbs.forEach(btn => {
      btn.addEventListener('click', () => {
        goToImage(parseInt(btn.getAttribute('data-index')));
      });
    });
    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        goToImage(parseInt(dot.getAttribute('data-index')));
      });
    });

    // Click on image opens Fullscreen Lightbox
    containerEl.querySelectorAll('.modal-carousel-img').forEach((img, idx) => {
      img.addEventListener('click', () => {
        Lightbox.open(images, idx);
      });
    });

    // Size Picker selection
    const sizeBtns = containerEl.querySelectorAll('.modal-size-btn');
    const sizeLabel = containerEl.querySelector('#modal-selected-size-label');
    sizeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        sizeBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedSize = btn.getAttribute('data-size');
        if (sizeLabel) sizeLabel.textContent = selectedSize;
      });
    });

    // WhatsApp 1-Click Enquiry
    containerEl.querySelector('#modal-wa-btn')?.addEventListener('click', () => {
      if (!currentProduct) return;
      const url = Store.buildWhatsAppUrl(null, currentProduct, selectedSize);
      if (url) window.open(url, '_blank');
    });

    // Add to WhatsApp Enquiry Tray
    const trayBtn = containerEl.querySelector('#modal-tray-btn');
    trayBtn?.addEventListener('click', () => {
      if (!currentProduct) return;
      if (Store.tray.has(currentProduct.id)) {
        Store.tray.remove(currentProduct.id);
        trayBtn.innerHTML = '<span>➕ Add to Multi-Item Tray</span>';
        App.showToast(`Removed from WhatsApp enquiry`);
      } else {
        Store.tray.add(currentProduct, selectedSize);
        trayBtn.innerHTML = '<span>✓ In WhatsApp Tray</span>';
        App.showToast(`Added to WhatsApp enquiry tray (${selectedSize})`);
      }
    });

    // Wishlist Button
    const wishlistBtn = containerEl.querySelector('#modal-wishlist-btn');
    wishlistBtn?.addEventListener('click', () => {
      if (!currentProduct) return;
      const isNowIn = Store.wishlist.toggle(currentProduct);
      wishlistBtn.classList.toggle('active', isNowIn);
      wishlistBtn.textContent = isNowIn ? '♥' : '♡';
      App.showToast(isNowIn ? 'Added to wishlist' : 'Removed from wishlist');
    });
  }

  return { init, open, close };
})();

window.ProductModal = ProductModal;
