/**
 * ─── Multi-Angle Sneaker Lightbox ───
 * Fullscreen high-resolution lightbox with 2x zoom toggle,
 * mouse pan, multi-angle navigation, and keyboard controls.
 */

const Lightbox = (() => {
  let images = [];
  let currentIndex = 0;
  let isZoomed = false;

  let elLightbox, elImage, elClose, elPrev, elNext;

  function init() {
    elLightbox = document.getElementById('lightbox');
    if (!elLightbox) return;

    elImage = elLightbox.querySelector('.lightbox-img');
    elClose = elLightbox.querySelector('.lightbox-close');
    elPrev = elLightbox.querySelector('.lightbox-nav.prev');
    elNext = elLightbox.querySelector('.lightbox-nav.next');

    // Close handlers
    elClose?.addEventListener('click', close);
    elLightbox.addEventListener('click', (e) => {
      if (e.target === elLightbox) close();
    });

    // Navigation
    elPrev?.addEventListener('click', (e) => {
      e.stopPropagation();
      prev();
    });
    elNext?.addEventListener('click', (e) => {
      e.stopPropagation();
      next();
    });

    // Zoom toggle
    elImage?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleZoom(e);
    });

    // Mouse pan when zoomed
    elLightbox.addEventListener('mousemove', (e) => {
      if (!isZoomed || !elImage) return;
      const rect = elLightbox.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      elImage.style.transformOrigin = `${x}% ${y}%`;
    });

    // Keyboard support
    document.addEventListener('keydown', (e) => {
      if (!elLightbox.classList.contains('active')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    });
  }

  function open(imageList, startIndex = 0) {
    if (!imageList || imageList.length === 0) return;
    images = imageList;
    currentIndex = Math.max(0, Math.min(startIndex, images.length - 1));
    isZoomed = false;

    renderImage();
    elLightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    elLightbox.classList.remove('active');
    document.body.style.overflow = '';
    resetZoom();
  }

  function renderImage() {
    if (!elImage) return;
    resetZoom();
    const item = images[currentIndex];
    const url = typeof item === 'string' ? item : (item.url || item.thumbnail_url);
    elImage.src = url;
    elImage.alt = item.alt_text || `Sneaker Angle ${currentIndex + 1}`;

    // Update nav visibility if single image
    if (elPrev) elPrev.style.display = images.length > 1 ? 'flex' : 'none';
    if (elNext) elNext.style.display = images.length > 1 ? 'flex' : 'none';
  }

  function next() {
    if (images.length <= 1) return;
    currentIndex = (currentIndex + 1) % images.length;
    renderImage();
  }

  function prev() {
    if (images.length <= 1) return;
    currentIndex = (currentIndex - 1 + images.length) % images.length;
    renderImage();
  }

  function toggleZoom(e) {
    isZoomed = !isZoomed;
    if (isZoomed) {
      elImage.classList.add('zoomed');
      if (e) {
        const rect = elLightbox.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        elImage.style.transformOrigin = `${x}% ${y}%`;
      }
    } else {
      resetZoom();
    }
  }

  function resetZoom() {
    isZoomed = false;
    if (elImage) {
      elImage.classList.remove('zoomed');
      elImage.style.transformOrigin = 'center center';
    }
  }

  return { init, open, close, next, prev };
})();

window.Lightbox = Lightbox;
