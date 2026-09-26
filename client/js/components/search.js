/**
 * ─── Autocomplete Search Component ───
 * Debounced search input with live autocomplete suggestions,
 * direct product selection, and clear button actions.
 */

const Search = (() => {
  let searchInput, clearBtn, suggestionsBox;
  let debounceTimer = null;

  function init(onFilterSubmit) {
    searchInput = document.getElementById('search-input');
    clearBtn = document.getElementById('search-clear');
    suggestionsBox = document.getElementById('search-suggestions');
    if (!searchInput) return;

    // Live typing debouncer
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      clearTimeout(debounceTimer);

      if (q.length < 2) {
        closeSuggestions();
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const suggestions = await Api.getSuggestions(q);
          renderSuggestions(suggestions);
        } catch (err) {
          console.error('[Search] Suggestions error:', err);
        }
      }, 250);
    });

    // Enter key triggers full catalog filter
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        closeSuggestions();
        if (onFilterSubmit) onFilterSubmit(searchInput.value.trim());
      }
      if (e.key === 'Escape') {
        closeSuggestions();
      }
    });

    // Clear search
    clearBtn?.addEventListener('click', () => {
      searchInput.value = '';
      closeSuggestions();
      if (onFilterSubmit) onFilterSubmit('');
    });

    // Click outside closes suggestions
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
        closeSuggestions();
      }
    });
  }

  function renderSuggestions(suggestions) {
    if (!suggestionsBox) return;

    if (!suggestions || suggestions.length === 0) {
      closeSuggestions();
      return;
    }

    suggestionsBox.innerHTML = suggestions.map(item => `
      <div class="search-suggestion-item" data-slug="${item.slug || item.id}">
        <img src="${item.image || 'https://images.unsplash.com/photo-1552346154-21d32810aba3?w=100'}" alt="${item.title}" />
        <div class="info">
          <div class="title">${item.title}</div>
          <div class="meta">${item.sku || ''} • ${Store.formatPrice(item.price)}</div>
        </div>
      </div>
    `).join('');

    suggestionsBox.classList.add('active');

    // Bind suggestion clicks
    suggestionsBox.querySelectorAll('.search-suggestion-item').forEach(el => {
      el.addEventListener('click', () => {
        const slug = el.getAttribute('data-slug');
        closeSuggestions();
        ProductModal.open(slug);
      });
    });
  }

  function closeSuggestions() {
    if (suggestionsBox) {
      suggestionsBox.classList.remove('active');
      suggestionsBox.innerHTML = '';
    }
  }

  function setValue(val) {
    if (searchInput) searchInput.value = val || '';
  }

  function getValue() {
    return searchInput ? searchInput.value.trim() : '';
  }

  return { init, setValue, getValue, closeSuggestions };
})();

window.Search = Search;
