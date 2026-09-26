/**
 * ─── Multi-Sneaker WhatsApp Enquiry Tray ───
 * Floating bottom tray that tracks selected sneakers for batch quotation.
 * Generates ready-to-send WhatsApp messages with live links, SKUs, and sizes.
 */

const EnquiryTray = (() => {
  let trayEl, countEl, itemsContainer, sendBtn, clearBtn, fabEl;

  function init() {
    trayEl = document.getElementById('enquiry-tray');
    if (!trayEl) return;

    countEl = trayEl.querySelector('.enquiry-tray-count');
    itemsContainer = trayEl.querySelector('.enquiry-tray-items');
    sendBtn = trayEl.querySelector('.enquiry-tray-send');
    clearBtn = trayEl.querySelector('#enquiry-tray-clear');
    fabEl = document.getElementById('wishlist-fab');

    // Subscribe to store updates
    Store.on('tray:change', render);

    // Initial render
    render({ items: Store.tray.getAll(), count: Store.tray.count() });

    // Send WhatsApp
    sendBtn?.addEventListener('click', () => {
      const items = Store.tray.getAll();
      if (items.length === 0) return;
      const url = Store.buildWhatsAppUrl(items);
      if (url) {
        window.open(url, '_blank');
      }
    });

    // Clear Tray
    clearBtn?.addEventListener('click', () => {
      Store.tray.clear();
      App.showToast('Enquiry tray cleared');
    });
  }

  function render(state) {
    if (!trayEl) return;
    const { items, count } = state;

    if (count > 0) {
      trayEl.classList.add('active');
      fabEl?.classList.add('has-tray');
      document.body.classList.add('has-enquiry-tray');
    } else {
      trayEl.classList.remove('active');
      fabEl?.classList.remove('has-tray');
      document.body.classList.remove('has-enquiry-tray');
    }

    if (countEl) {
      countEl.innerHTML = `<strong>${count}</strong> sneaker${count === 1 ? '' : 's'} selected`;
    }

    if (itemsContainer) {
      itemsContainer.innerHTML = items.map(item => `
        <div class="enquiry-tray-thumb" title="${item.title} (${item.selectedSize || 'Standard'})">
          <img src="${item.image || 'https://images.unsplash.com/photo-1552346154-21d32810aba3?w=100'}" alt="${item.title}" />
          <button class="remove" data-id="${item.id}" title="Remove">✕</button>
        </div>
      `).join('');

      // Bind remove handlers
      itemsContainer.querySelectorAll('.remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          Store.tray.remove(id);
          App.showToast('Removed item from enquiry');
        });
      });
    }
  }

  return { init };
})();

window.EnquiryTray = EnquiryTray;
