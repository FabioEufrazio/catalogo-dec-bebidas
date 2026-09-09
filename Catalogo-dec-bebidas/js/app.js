/* ==========================================================================
   Main Application Controller (app.js)
   Mode Handling, Rendering, Pagination, Keyboard Shortcuts & Event Handlers
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Category Definitions
  const CATEGORIES = [
    { id: 'all', label: 'Todos', icon: 'fa-layer-group' },
    { id: 'whiskies', label: 'Whiskies', icon: 'fa-bottle-droplet' },
    { id: 'vodkas', label: 'Vodkas', icon: 'fa-glass-water' },
    { id: 'cervejas', label: 'Cervejas', icon: 'fa-beer-mug-empty' },
    { id: 'gins', label: 'Gins', icon: 'fa-glass-whiskey' },
    { id: 'vinhos', label: 'Vinhos', icon: 'fa-wine-glass' },
    { id: 'espumantes', label: 'Espumantes', icon: 'fa-champagne-glasses' },
    { id: 'energeticos', label: 'Energéticos', icon: 'fa-bolt' },
    { id: 'refrigerantes', label: 'Refrigerantes', icon: 'fa-bottle-pop' },
    { id: 'aguadecoco', label: 'Água de Coco', icon: 'fa-bottle-water' },
    { id: 'sucos', label: 'Sucos', icon: 'fa-glass-water-droplet' },
    { id: 'licores', label: 'Licores', icon: 'fa-wine-glass-empty' },
    { id: 'xaropes', label: 'Xaropes', icon: 'fa-prescription-bottle' },
    { id: 'outros', label: 'Outros', icon: 'fa-boxes-stacked' }
  ];

  // State Variables
  let isClientMode = false;
  let currentCategory = 'all';
  let searchQuery = '';
  let currentPage = 1;
  const itemsPerPage = 24;
  const selectedProductIds = new Set();
  let focusedCardProductId = null;
  let pendingImportData = null;

  // Initialize Realtime Engine
  const realtimeEngine = new RealtimeEngine(productStore);

  // Helper: Format Currency (BRL)
  function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value || 0);
  }

  // Toast Helper
  function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation';
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // 2. Check Operating Mode (Admin vs Client)
  function checkMode() {
    const params = new URLSearchParams(window.location.search);
    isClientMode = params.get('view') === 'public' || params.get('client') === '1';

    if (isClientMode) {
      document.body.classList.add('client-mode');
      const titleEl = document.getElementById('appHeaderTitle');
      if (titleEl) titleEl.textContent = 'Catálogo de Produtos';
    } else {
      document.body.classList.remove('client-mode');
    }
  }

  // 3. Sync Price Mode UI Badges
  function syncPriceModeUI() {
    const hidePrices = productStore.getHidePrices();
    const html = document.documentElement;
    const body = document.body;

    if (hidePrices) {
      html.classList.add('prices-hidden');
      body.classList.add('prices-hidden');
    } else {
      html.classList.remove('prices-hidden');
      body.classList.remove('prices-hidden');
    }

    const toggleBtn = document.getElementById('togglePricesBtn');

    if (toggleBtn) {
      if (hidePrices) {
        toggleBtn.innerHTML = '<i class="fa-solid fa-eye"></i> Exibir Preços';
      } else {
        toggleBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Ocultar Preços';
      }
    }
  }

  // 4. Render Category Pills
  function renderCategoryPills() {
    const container = document.getElementById('categoryPills');
    if (!container) return;

    const allProducts = productStore.getProducts();

    // Calculate Counts
    const counts = {};
    CATEGORIES.forEach(c => counts[c.id] = 0);

    allProducts.forEach(p => {
      if (isClientMode && !p.active) return;
      counts['all']++;
      const catKey = counts[p.category] !== undefined ? p.category : 'outros';
      counts[catKey]++;
    });

    container.innerHTML = '';

    CATEGORIES.forEach(cat => {
      const count = counts[cat.id] || 0;
      // Hide empty categories in client mode (except 'all')
      if (cat.id !== 'all' && count === 0) return;

      const btn = document.createElement('button');
      btn.className = `pill-btn ${currentCategory === cat.id ? 'active' : ''}`;
      btn.innerHTML = `
        <i class="fa-solid ${cat.icon}"></i>
        <span>${cat.label}</span>
        <span class="pill-count">${count}</span>
      `;

      btn.addEventListener('click', () => {
        currentCategory = cat.id;
        currentPage = 1;
        renderCategoryPills();
        renderProducts();
      });

      container.appendChild(btn);
    });
  }

  // 5. Render Product Grid & Pagination
  function renderProducts() {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;

    let products = productStore.getProducts();

    // Filter active items in client mode
    if (isClientMode) {
      products = products.filter(p => p.active);
    }

    // Filter by Category
    if (currentCategory !== 'all') {
      products = products.filter(p => p.category === currentCategory);
    }

    // Filter by Search Query
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      products = products.filter(p => 
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.code && String(p.code).toLowerCase().includes(q))
      );
    }

    // Update Header Total Badge
    const headerBadge = document.getElementById('headerTotalBadge');
    if (headerBadge) {
      headerBadge.textContent = `${products.length} ${products.length === 1 ? 'item' : 'itens'}`;
    }

    if (products.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-wine-bottle"></i>
          <h3>Nenhum produto encontrado</h3>
          <p>Tente ajustar os filtros de categoria ou busca.</p>
        </div>
      `;
      renderPagination(0);
      return;
    }

    // Pagination Calculation
    const totalPages = Math.ceil(products.length / itemsPerPage);
    currentPage = Math.max(1, Math.min(currentPage, totalPages));

    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedProducts = products.slice(startIndex, startIndex + itemsPerPage);

    grid.innerHTML = '';

    paginatedProducts.forEach(product => {
      const card = createProductCard(product);
      grid.appendChild(card);
    });

    renderPagination(totalPages);
    updateBulkActionsBarUI();
  }

  // Helper: Set Active Paste Target Card
  function setActivePasteTarget(productId) {
    if (focusedCardProductId === productId && productId !== null) return;
    focusedCardProductId = productId;
    document.querySelectorAll('.product-card').forEach(card => {
      if (productId && card.dataset.id === productId) {
        card.classList.add('active-paste-target');
      } else {
        card.classList.remove('active-paste-target');
      }
    });
  }

  // Create Individual Product Card DOM Element
  function createProductCard(p) {
    const isTarget = focusedCardProductId === p.id;
    const card = document.createElement('div');
    card.className = `product-card ${!p.active ? 'inactive-product' : ''} ${selectedProductIds.has(p.id) ? 'selected-card' : ''} ${isTarget ? 'active-paste-target' : ''}`;
    card.dataset.id = p.id;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.admin-only-ui') || ['INPUT', 'BUTTON', 'I', 'LABEL', 'SELECT'].includes(e.target.tagName)) {
        return;
      }
      setActivePasteTarget(p.id);
    });

    const boxTotal = p.unitPrice * p.qtyPerBox;
    const catLabel = (CATEGORIES.find(c => c.id === p.category) || {}).label || 'Outros';

    card.innerHTML = `
      <!-- Admin Bar -->
      <div class="product-card-admin-bar admin-only-ui">
        <div class="product-checkbox-wrapper">
          <input type="checkbox" class="product-checkbox" ${selectedProductIds.has(p.id) ? 'checked' : ''}>
          <div class="pos-badge-wrapper" title="Clique para digitar a nova posição (ex: 1, 5, 372)">
            <span>POS:</span>
            <input type="number" class="pos-badge-input" value="${p.manualPosition}" min="1" title="Digite a nova posição no catálogo">
          </div>
        </div>
        <div class="product-actions-bar">
          <button class="icon-action-btn toggle-active-btn" title="${p.active ? 'Desativar Produto' : 'Ativar Produto'}">
            <i class="fa-solid ${p.active ? 'fa-toggle-on' : 'fa-toggle-off'}" style="color:${p.active ? 'var(--status-active)' : 'var(--text-dim)'}; font-size:1.1rem;"></i>
          </button>
          <button class="icon-action-btn edit-btn" title="Editar Produto">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="icon-action-btn duplicate-btn" title="Duplicar">
            <i class="fa-solid fa-copy"></i>
          </button>
          <button class="icon-action-btn delete-btn" title="Excluir">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>

      <!-- Image Area -->
      <div class="product-image-container ${p.imageBase64 ? 'has-image' : ''}">
        <span class="category-tag">${catLabel}</span>
        ${p.code ? `<span class="sku-code-tag">COD: ${p.code}</span>` : ''}
        ${p.imageBase64 ? 
          `<img src="${p.imageBase64}" alt="${p.description}" class="product-img" loading="lazy" decoding="async">` :
          `<div class="product-no-img">
             <i class="fa-solid fa-wine-bottle"></i>
             <span>Sem Foto</span>
           </div>
           <button class="center-google-btn admin-only-ui">
             <i class="fa-brands fa-google"></i> Buscar Foto
           </button>`
        }
      </div>

      <!-- Body Area -->
      <div class="product-card-body">
        <h4 class="product-title" title="${p.description}">${p.description}</h4>

        <div class="price-details-box">
          <div class="price-unit-row">
            <span class="price-label">Unidade:</span>
            <span class="price-unit-val">${formatCurrency(p.unitPrice)}</span>
          </div>
          ${p.showBoxTotal && p.qtyPerBox > 1 ? `
            <div class="price-box-row">
              <span>Caixa c/ <strong>${p.qtyPerBox}</strong> un:</span>
              <span class="price-box-val">${formatCurrency(boxTotal)}</span>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // Event Listeners on Card Elements

    // 1. Checkbox for Bulk Selection
    const checkbox = card.querySelector('.product-checkbox');
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          selectedProductIds.add(p.id);
          card.classList.add('selected-card');
        } else {
          selectedProductIds.delete(p.id);
          card.classList.remove('selected-card');
        }
        updateBulkActionsBarUI();
      });
    }

    // 2. POS Badge & Input Change
    const posWrapper = card.querySelector('.pos-badge-wrapper');
    const posInput = card.querySelector('.pos-badge-input');

    if (posWrapper && posInput) {
      const stopEvents = ['mousedown', 'mouseup', 'click', 'pointerdown', 'focusin'];
      stopEvents.forEach(evt => {
        posWrapper.addEventListener(evt, (e) => e.stopPropagation());
        posInput.addEventListener(evt, (e) => e.stopPropagation());
      });

      posWrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        posInput.focus();
        posInput.select();
      });

      posInput.addEventListener('focus', (e) => {
        e.stopPropagation();
        posInput.select(); // Auto-select number on focus for instant typing
      });

      posInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          posInput.blur(); // Apply change on Enter
        }
      });

      posInput.addEventListener('change', (e) => {
        const val = parseInt(e.target.value);
        if (!isNaN(val) && val > 0) {
          productStore.reorderProduct(p.id, val);
          showToast(`Posição de "${p.description}" alterada para ${val}.`);
        }
      });
    }

    // 3. Google Quick Search (Center Photo Button)
    const centerGoogleBtn = card.querySelector('.center-google-btn');
    if (centerGoogleBtn) {
      centerGoogleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setActivePasteTarget(p.id);
        ImageUtils.openGoogleImageSearch(p.description);
      });
    }

    // 4. Toggle Active Status
    const toggleActiveBtn = card.querySelector('.toggle-active-btn');
    if (toggleActiveBtn) {
      toggleActiveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        productStore.updateProduct(p.id, { active: !p.active });
        showToast(`Produto "${p.description}" ${!p.active ? 'ativado' : 'desativado'}.`);
      });
    }

    // 5. Edit Button
    const editBtn = card.querySelector('.edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditProductModal(p);
      });
    }

    // 6. Duplicate Button
    const duplicateBtn = card.querySelector('.duplicate-btn');
    if (duplicateBtn) {
      duplicateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const copy = productStore.duplicateProduct(p.id);
        if (copy) showToast(`Cópia criada: "${copy.description}".`);
      });
    }

    // 7. Delete Button
    const deleteBtn = card.querySelector('.delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Deseja realmente excluir "${p.description}"?`)) {
          productStore.deleteProduct(p.id);
          selectedProductIds.delete(p.id);
          showToast(`Produto excluído.`);
        }
      });
    }

    return card;
  }

  // Compact Pagination Controls
  function renderPagination(totalPages) {
    const container = document.getElementById('paginationContainer');
    if (!container) return;

    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = '';

    // Previous Button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'page-btn';
    prevBtn.disabled = currentPage === 1;
    prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
    prevBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        renderProducts();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    container.appendChild(prevBtn);

    // Build Compact Page Numbers array
    const pages = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');

      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
      }

      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }

    pages.forEach(p => {
      if (p === '...') {
        const dots = document.createElement('span');
        dots.style.cssText = 'color: var(--text-muted); font-size: 0.85rem; padding: 0 4px; user-select: none;';
        dots.textContent = '...';
        container.appendChild(dots);
      } else {
        const pageBtn = document.createElement('button');
        pageBtn.className = `page-btn ${p === currentPage ? 'active' : ''}`;
        pageBtn.textContent = p;
        pageBtn.addEventListener('click', () => {
          currentPage = p;
          renderProducts();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        container.appendChild(pageBtn);
      }
    });

    // Next Button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'page-btn';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
    nextBtn.addEventListener('click', () => {
      if (currentPage < totalPages) {
        currentPage++;
        renderProducts();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    container.appendChild(nextBtn);
  }

  // Update Floating Bulk Actions Bar UI
  function updateBulkActionsBarUI() {
    const bar = document.getElementById('bulkActionsBar');
    const countEl = document.getElementById('bulkSelectedCount');
    if (!bar) return;

    const count = selectedProductIds.size;
    if (count > 0 && !isClientMode) {
      bar.classList.add('visible');
      if (countEl) {
        countEl.innerHTML = `<i class="fa-solid fa-square-check"></i> ${count} ${count === 1 ? 'selecionado' : 'selecionados'}`;
      }
    } else {
      bar.classList.remove('visible');
    }
  }

  // Open Modal Helper
  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  }

  // Setup Close Modal Event Listeners
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      closeModal(modalId);
    });
  });

  // Lightbox Handler
  function openLightbox(product) {
    const titleEl = document.getElementById('lightboxTitle');
    const imgEl = document.getElementById('lightboxImage');
    const unitPriceEl = document.getElementById('lightboxUnitPrice');
    const qtyEl = document.getElementById('lightboxQty');
    const boxTotalEl = document.getElementById('lightboxBoxTotal');
    const boxRowEl = document.getElementById('lightboxBoxRow');

    if (titleEl) titleEl.textContent = product.description;
    if (imgEl) {
      imgEl.src = product.imageBase64 || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="%239ca3af" stroke-width="1.5"><path d="M8 22h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"></path><path d="M9 2h6v3H9z"></path></svg>';
    }
    if (unitPriceEl) unitPriceEl.textContent = formatCurrency(product.unitPrice);
    if (qtyEl) qtyEl.textContent = product.qtyPerBox;
    if (boxTotalEl) boxTotalEl.textContent = formatCurrency(product.unitPrice * product.qtyPerBox);

    if (boxRowEl) {
      boxRowEl.style.display = (product.showBoxTotal && product.qtyPerBox > 1) ? 'flex' : 'none';
    }

    openModal('lightboxModal');
  }

  // Form Create / Edit Product
  let currentBase64Image = '';

  function openEditProductModal(product = null) {
    const form = document.getElementById('productForm');
    if (!form) return;
    form.reset();

    const titleEl = document.getElementById('productModalTitle');
    const idInput = document.getElementById('editProductId');
    const previewContainer = document.getElementById('imagePreviewContainer');
    const previewImg = document.getElementById('formImagePreview');

    currentBase64Image = '';

    if (product) {
      if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Editar Produto';
      idInput.value = product.id;
      document.getElementById('prodCode').value = product.code || '';
      document.getElementById('prodCategory').value = product.category || 'outros';
      document.getElementById('prodDescription').value = product.description || '';
      document.getElementById('prodUnitPrice').value = product.unitPrice || '';
      document.getElementById('prodQtyPerBox').value = product.qtyPerBox || 1;
      document.getElementById('prodActive').checked = product.active !== false;
      document.getElementById('prodShowBoxTotal').checked = product.showBoxTotal !== false;

      if (product.imageBase64) {
        currentBase64Image = product.imageBase64;
        previewImg.src = currentBase64Image;
        previewContainer.style.display = 'block';
      } else {
        previewContainer.style.display = 'none';
      }
    } else {
      if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-box-open"></i> Cadastrar Produto';
      idInput.value = '';
      previewContainer.style.display = 'none';
    }

    openModal('productModal');
  }

  // Auto-detect Category on Description Typing in Form
  const descInput = document.getElementById('prodDescription');
  if (descInput) {
    descInput.addEventListener('input', (e) => {
      const text = e.target.value;
      const detected = excelEngine.detectCategory(text);
      const catSelect = document.getElementById('prodCategory');
      if (catSelect && detected) {
        catSelect.value = detected;
      }
    });
  }

  // File Upload Input Handler
  const fileInput = document.getElementById('prodImageFile');
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          currentBase64Image = await ImageUtils.handleFileUpload(file);
          const previewContainer = document.getElementById('imagePreviewContainer');
          const previewImg = document.getElementById('formImagePreview');
          previewImg.src = currentBase64Image;
          previewContainer.style.display = 'block';
        } catch (err) {
          alert(err.message);
        }
      }
    });
  }

  // Remove Image Button in Form
  const removeImgBtn = document.getElementById('removeImageBtn');
  if (removeImgBtn) {
    removeImgBtn.addEventListener('click', () => {
      currentBase64Image = '';
      document.getElementById('prodImageFile').value = '';
      document.getElementById('imagePreviewContainer').style.display = 'none';
    });
  }

  // Form Google Search Button
  const formGoogleBtn = document.getElementById('formGoogleSearchBtn');
  if (formGoogleBtn) {
    formGoogleBtn.addEventListener('click', () => {
      const text = document.getElementById('prodDescription').value;
      if (text) {
        ImageUtils.openGoogleImageSearch(text);
      } else {
        alert("Digite a descrição do produto primeiro.");
      }
    });
  }

  // Form Submit
  const productForm = document.getElementById('productForm');
  if (productForm) {
    productForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('editProductId').value;
      const data = {
        code: document.getElementById('prodCode').value,
        category: document.getElementById('prodCategory').value,
        description: document.getElementById('prodDescription').value,
        unitPrice: parseFloat(document.getElementById('prodUnitPrice').value) || 0,
        qtyPerBox: parseInt(document.getElementById('prodQtyPerBox').value) || 1,
        active: document.getElementById('prodActive').checked,
        showBoxTotal: document.getElementById('prodShowBoxTotal').checked,
        imageBase64: currentBase64Image
      };

      if (id) {
        productStore.updateProduct(id, data);
        showToast(`Produto "${data.description}" atualizado.`);
      } else {
        productStore.addProduct(data);
        showToast(`Produto "${data.description}" cadastrado.`);
      }

      closeModal('productModal');
    });
  }

  // 6. Excel/CSV Import & Column Mapping Handlers
  let pendingGridData = null;

  const importExcelBtn = document.getElementById('importExcelBtn');
  if (importExcelBtn) {
    importExcelBtn.addEventListener('click', () => openModal('excelModal'));
  }

  const processExcelBtn = document.getElementById('processExcelBtn');
  if (processExcelBtn) {
    processExcelBtn.addEventListener('click', async () => {
      const fileInput = document.getElementById('excelFileInput');
      const pasteArea = document.getElementById('excelPasteArea');
      let gridResult = null;

      try {
        if (fileInput.files && fileInput.files[0]) {
          gridResult = await excelEngine.parseFileToGrid(fileInput.files[0]);
        } else if (pasteArea.value.trim()) {
          gridResult = excelEngine.parsePastedTextToGrid(pasteArea.value);
        } else {
          alert("Por favor, selecione um arquivo de planilha ou cole o conteúdo.");
          return;
        }

        if (!gridResult || !gridResult.headers || gridResult.headers.length === 0) {
          alert("Nenhuma coluna foi encontrada na planilha.");
          return;
        }

        pendingGridData = gridResult;
        populateMappingSelects(gridResult);

        closeModal('excelModal');
        openModal('mappingModal');

      } catch (err) {
        alert("Erro ao ler planilha: " + err.message);
      }
    });
  }

  // Populate Dropdowns in Column Mapping Modal
  function populateMappingSelects(gridResult) {
    const selects = {
      code: document.getElementById('mapCodeSelect'),
      description: document.getElementById('mapDescSelect'),
      unitPrice: document.getElementById('mapUnitPriceSelect'),
      boxPrice: document.getElementById('mapBoxPriceSelect'),
      qtyPerBox: document.getElementById('mapQtyBoxSelect')
    };

    const headers = gridResult.headers;
    const auto = gridResult.autoMapped;

    Object.keys(selects).forEach(key => {
      const select = selects[key];
      if (!select) return;
      select.innerHTML = '<option value="-1">-- Ignorar Coluna --</option>';

      headers.forEach((h, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${h} (Coluna ${idx + 1})`;
        if (auto[key] === idx) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
    });
  }

  // Confirm Mapping Button Handler
  const confirmMappingBtn = document.getElementById('confirmMappingBtn');
  if (confirmMappingBtn) {
    confirmMappingBtn.addEventListener('click', () => {
      if (!pendingGridData) return;

      const mapping = {
        code: parseInt(document.getElementById('mapCodeSelect').value),
        description: parseInt(document.getElementById('mapDescSelect').value),
        unitPrice: parseInt(document.getElementById('mapUnitPriceSelect').value),
        boxPrice: parseInt(document.getElementById('mapBoxPriceSelect').value),
        qtyPerBox: parseInt(document.getElementById('mapQtyBoxSelect').value)
      };

      if (mapping.code === -1 && mapping.description === -1) {
        alert("Selecione pelo menos a coluna de Código ou Descrição do produto.");
        return;
      }

      const items = excelEngine.processItemsWithMapping(
        pendingGridData.rawRows,
        pendingGridData.headerRowIdx,
        mapping
      );

      if (items.length === 0) {
        alert("Nenhum produto válido pôde ser extraído com o mapeamento selecionado.");
        return;
      }

      const diff = excelEngine.analyzeDiff(items, productStore.getProducts());
      pendingImportData = diff;

      renderDiffModal(diff);
      closeModal('mappingModal');
      openModal('diffModal');
    });
  }

  function renderDiffModal(diff) {
    const newCountEl = document.getElementById('diffNewCount');
    const updatedCountEl = document.getElementById('diffUpdatedCount');
    const tbody = document.getElementById('diffTableBody');

    if (newCountEl) newCountEl.textContent = `${diff.newItems.length} Novos Produtos`;
    if (updatedCountEl) updatedCountEl.textContent = `${diff.updated.length} Atualizados`;

    if (!tbody) return;
    tbody.innerHTML = '';

    // Render Updated
    diff.updated.forEach(item => {
      const tr = document.createElement('tr');
      tr.className = 'diff-row-updated';

      const priceDiff = item.newPrice - item.oldPrice;
      let priceIndicator = '';
      if (priceDiff > 0.001) {
        priceIndicator = `<span class="price-up">▲ ${formatCurrency(item.newPrice)}</span>`;
      } else if (priceDiff < -0.001) {
        priceIndicator = `<span class="price-down">▼ ${formatCurrency(item.newPrice)}</span>`;
      } else {
        priceIndicator = `<span>${formatCurrency(item.newPrice)}</span>`;
      }

      tr.innerHTML = `
        <td><code>${item.imported.code || item.existing.code || '-'}</code></td>
        <td><strong>${item.imported.description || item.existing.description}</strong></td>
        <td><span class="badge badge-warning">Atualização</span></td>
        <td>${formatCurrency(item.oldPrice)}</td>
        <td>${priceIndicator}</td>
        <td>${item.newQty}</td>
      `;
      tbody.appendChild(tr);
    });

    // Render New
    diff.newItems.forEach(item => {
      const tr = document.createElement('tr');
      tr.className = 'diff-row-new';
      tr.innerHTML = `
        <td><code>${item.code || '-'}</code></td>
        <td><strong>${item.description}</strong></td>
        <td><span class="badge badge-active">Novo Item</span></td>
        <td>-</td>
        <td><strong style="color:var(--accent-gold);">${formatCurrency(item.unitPrice)}</strong></td>
        <td>${item.qtyPerBox}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Confirm Import
  const confirmImportBtn = document.getElementById('confirmImportBtn');
  if (confirmImportBtn) {
    confirmImportBtn.addEventListener('click', () => {
      if (!pendingImportData) return;

      const { updated, newItems } = pendingImportData;

      // Update existing (including updating description and code from imported spreadsheet)
      updated.forEach(u => {
        productStore.updateProduct(u.existing.id, {
          code: u.imported.code,
          description: u.imported.description,
          unitPrice: u.newPrice,
          qtyPerBox: u.newQty
        });
      });

      // Add new
      newItems.forEach(n => {
        productStore.addProduct(n);
      });

      showToast(`Importação concluída! ${updated.length} atualizados, ${newItems.length} novos cadastrados.`);
      closeModal('diffModal');
      pendingImportData = null;
    });
  }

  // 7. Bulk Action Buttons Handlers
  const bulkPriceBtn = document.getElementById('bulkPriceBtn');
  if (bulkPriceBtn) {
    bulkPriceBtn.addEventListener('click', () => openModal('bulkPriceModal'));
  }

  const confirmBulkPriceBtn = document.getElementById('confirmBulkPriceBtn');
  if (confirmBulkPriceBtn) {
    confirmBulkPriceBtn.addEventListener('click', () => {
      const unitPriceVal = document.getElementById('bulkUnitPriceInput').value;
      const qtyVal = document.getElementById('bulkQtyPerBoxInput').value;

      const unitPrice = unitPriceVal !== '' ? parseFloat(unitPriceVal) : undefined;
      const qtyPerBox = qtyVal !== '' ? parseInt(qtyVal) : undefined;

      const ids = Array.from(selectedProductIds);
      productStore.bulkUpdatePrice(ids, unitPrice, qtyPerBox);

      showToast(`Preço atualizado em lote para ${ids.length} itens.`);
      closeModal('bulkPriceModal');
      selectedProductIds.clear();
      renderProducts();
    });
  }

  const bulkCategoryBtn = document.getElementById('bulkCategoryBtn');
  if (bulkCategoryBtn) {
    bulkCategoryBtn.addEventListener('click', () => openModal('bulkCategoryModal'));
  }

  const confirmBulkCategoryBtn = document.getElementById('confirmBulkCategoryBtn');
  if (confirmBulkCategoryBtn) {
    confirmBulkCategoryBtn.addEventListener('click', () => {
      const cat = document.getElementById('bulkCategorySelect').value;
      const ids = Array.from(selectedProductIds);

      productStore.bulkUpdateCategory(ids, cat);

      showToast(`Categoria alterada em lote para ${ids.length} itens.`);
      closeModal('bulkCategoryModal');
      selectedProductIds.clear();
      renderProducts();
    });
  }

  const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener('click', () => {
      const ids = Array.from(selectedProductIds);
      if (confirm(`Deseja realmente excluir os ${ids.length} produtos selecionados?`)) {
        productStore.bulkDelete(ids);
        showToast(`${ids.length} produtos excluídos.`);
        selectedProductIds.clear();
        renderProducts();
      }
    });
  }

  const bulkCancelBtn = document.getElementById('bulkCancelBtn');
  if (bulkCancelBtn) {
    bulkCancelBtn.addEventListener('click', () => {
      selectedProductIds.clear();
      renderProducts();
    });
  }

  // 8. Toolbar Buttons
  const togglePricesBtn = document.getElementById('togglePricesBtn');
  if (togglePricesBtn) {
    togglePricesBtn.addEventListener('click', () => {
      const current = productStore.getHidePrices();
      productStore.setHidePrices(!current);
      showToast(current ? 'Preços estão VISÍVEIS para o cliente.' : 'Preços estão OCULTOS para o cliente.', current ? 'success' : 'error');
    });
  }

  const newProductBtn = document.getElementById('newProductBtn');
  if (newProductBtn) {
    newProductBtn.addEventListener('click', () => openEditProductModal(null));
  }

  const shareLinkBtn = document.getElementById('shareLinkBtn');
  const headerClientLinkBtn = document.getElementById('headerClientLinkBtn');

  const autoCategorizeBtn = document.getElementById('autoCategorizeBtn');
  if (autoCategorizeBtn) {
    autoCategorizeBtn.addEventListener('click', () => {
      const updatedCount = productStore.autoCategorizeAll(excelEngine);
      if (updatedCount > 0) {
        showToast(`🪄 ${updatedCount} bebidas organizadas em suas categorias com sucesso!`);
      } else {
        showToast('Todas as bebidas já estão em suas categorias corretas.');
      }
    });
  }

  function openShareLinkModal() {
    const input = document.getElementById('clientLinkInput');
    const publicUrl = `${window.location.origin}${window.location.pathname}?view=public`;
    if (input) input.value = publicUrl;
    openModal('clientLinkModal');
  }

  if (shareLinkBtn) shareLinkBtn.addEventListener('click', openShareLinkModal);
  if (headerClientLinkBtn) headerClientLinkBtn.addEventListener('click', openShareLinkModal);

  const copyClientLinkBtn = document.getElementById('copyClientLinkBtn');
  if (copyClientLinkBtn) {
    copyClientLinkBtn.addEventListener('click', () => {
      const input = document.getElementById('clientLinkInput');
      if (input) {
        input.select();
        navigator.clipboard.writeText(input.value);
        showToast('Link do Cliente copiado com sucesso!');
      }
    });
  }

  const openClientTabBtn = document.getElementById('openClientTabBtn');
  if (openClientTabBtn) {
    openClientTabBtn.addEventListener('click', () => {
      const publicUrl = `${window.location.origin}${window.location.pathname}?view=public`;
      window.open(publicUrl, '_blank');
    });
  }

  const clearCatalogBtn = document.getElementById('clearCatalogBtn');
  if (clearCatalogBtn) {
    clearCatalogBtn.addEventListener('click', () => {
      if (confirm('ATENÇÃO: Deseja realmente zerar TODO o catálogo de produtos?')) {
        productStore.clearAll();
        showToast('Catálogo zerado.', 'error');
      }
    });
  }

  // Undo / Redo Buttons
  const undoBtn = document.getElementById('undoBtn');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      if (productStore.undo()) showToast('Ação desfeita (Undo).');
    });
  }

  const redoBtn = document.getElementById('redoBtn');
  if (redoBtn) {
    redoBtn.addEventListener('click', () => {
      if (productStore.redo()) showToast('Ação refeita (Redo).');
    });
  }

  // Firebase Config Buttons
  const firebaseConfigBtn = document.getElementById('firebaseConfigBtn');
  if (firebaseConfigBtn) {
    firebaseConfigBtn.addEventListener('click', () => {
      const raw = localStorage.getItem(STORAGE_KEYS.FIREBASE_CONFIG);
      if (raw) {
        try {
          const config = JSON.parse(raw);
          document.getElementById('fbApiKey').value = config.apiKey || '';
          document.getElementById('fbProjectId').value = config.projectId || '';
        } catch (e) {}
      }
      openModal('firebaseModal');
    });
  }

  // Firebase Configuration Modal Handling
  const fbSnippetArea = document.getElementById('fbSnippetArea');
  const fbApiKeyInput = document.getElementById('fbApiKey');
  const fbProjectIdInput = document.getElementById('fbProjectId');
  const fbAppIdInput = document.getElementById('fbAppId');
  const fbWarningAlert = document.getElementById('fbWarningAlert');

  function loadFirebaseModalInputs() {
    const rawConfig = localStorage.getItem(STORAGE_KEYS.FIREBASE_CONFIG);
    if (!rawConfig) return;
    try {
      const cfg = JSON.parse(rawConfig);
      if (fbApiKeyInput && cfg.apiKey) fbApiKeyInput.value = cfg.apiKey;
      if (fbProjectIdInput && cfg.projectId) fbProjectIdInput.value = cfg.projectId;
      if (fbAppIdInput && cfg.appId) fbAppIdInput.value = cfg.appId;
    } catch (e) {}
  }
  loadFirebaseModalInputs();

  if (fbSnippetArea) {
    fbSnippetArea.addEventListener('input', (e) => {
      const text = e.target.value;
      const apiKeyMatch = text.match(/apiKey["']?\s*:\s*["']([^"']+)["']/);
      const projectIdMatch = text.match(/projectId["']?\s*:\s*["']([^"']+)["']/);
      const appIdMatch = text.match(/appId["']?\s*:\s*["']([^"']+)["']/);

      if (apiKeyMatch && fbApiKeyInput) fbApiKeyInput.value = apiKeyMatch[1];
      if (projectIdMatch && fbProjectIdInput) fbProjectIdInput.value = projectIdMatch[1];
      if (appIdMatch && fbAppIdInput) fbAppIdInput.value = appIdMatch[1];

      if (apiKeyMatch || projectIdMatch || appIdMatch) {
        showToast('Credenciais extraídas do código com sucesso!');
      }
    });
  }

  const saveFirebaseBtn = document.getElementById('saveFirebaseBtn');
  if (saveFirebaseBtn) {
    saveFirebaseBtn.addEventListener('click', () => {
      let apiKey = fbApiKeyInput ? fbApiKeyInput.value.trim() : '';
      let projectId = fbProjectIdInput ? fbProjectIdInput.value.trim() : '';
      let appId = fbAppIdInput ? fbAppIdInput.value.trim() : '';

      // Auto-fix if user put App ID (starts with 1:) in API Key field
      if (apiKey.startsWith('1:') && !appId) {
        appId = apiKey;
        apiKey = '';
        if (fbAppIdInput) fbAppIdInput.value = appId;
        if (fbApiKeyInput) fbApiKeyInput.value = '';
      }

      if (!apiKey || apiKey.startsWith('1:')) {
        if (fbWarningAlert) {
          fbWarningAlert.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <strong>Atenção:</strong> O código <code>1:3784...</code> é o <strong>App ID</strong>, não a API Key! A API Key começa com <code>AIzaSy...</code>. Por favor, insira a API Key correta no primeiro campo.';
          fbWarningAlert.style.display = 'block';
        }
        return;
      }

      if (!projectId) {
        if (fbWarningAlert) {
          fbWarningAlert.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Por favor, informe o Project ID (ex: <code>catalogo-dec-bebidas</code>).';
          fbWarningAlert.style.display = 'block';
        }
        return;
      }

      if (fbWarningAlert) fbWarningAlert.style.display = 'none';

      const config = { apiKey, projectId, appId };
      localStorage.setItem(STORAGE_KEYS.FIREBASE_CONFIG, JSON.stringify(config));
      showToast('Configuração do Firebase salva! Recarregando...');
      closeModal('firebaseModal');
      setTimeout(() => location.reload(), 600);
    });
  }

  const clearFirebaseBtn = document.getElementById('clearFirebaseBtn');
  if (clearFirebaseBtn) {
    clearFirebaseBtn.addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEYS.FIREBASE_CONFIG);
      if (fbApiKeyInput) fbApiKeyInput.value = '';
      if (fbProjectIdInput) fbProjectIdInput.value = '';
      if (fbAppIdInput) fbAppIdInput.value = '';
      if (fbSnippetArea) fbSnippetArea.value = '';
      showToast('Firebase desconectado e credenciais removidas.', 'error');
      closeModal('firebaseModal');
      setTimeout(() => location.reload(), 500);
    });
  }

  // Firebase Auth Login / Logout Handlers
  const loginModalBtn = document.getElementById('loginModalBtn');
  if (loginModalBtn) {
    loginModalBtn.addEventListener('click', () => openModal('adminLoginModal'));
  }

  const adminLoginForm = document.getElementById('adminLoginForm');
  if (adminLoginForm) {
    adminLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      const errorMsgEl = document.getElementById('loginErrorMessage');

      if (errorMsgEl) errorMsgEl.style.display = 'none';

      try {
        await realtimeEngine.login(email, password);
        showToast(`Bem-vindo, ${email}! Login efetuado com sucesso.`);
        closeModal('adminLoginModal');
      } catch (err) {
        if (errorMsgEl) {
          errorMsgEl.textContent = err.message;
          errorMsgEl.style.display = 'block';
        }
      }
    });
  }

  const signupBtn = document.getElementById('signupBtn');
  if (signupBtn) {
    signupBtn.addEventListener('click', async () => {
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      const errorMsgEl = document.getElementById('loginErrorMessage');

      if (errorMsgEl) errorMsgEl.style.display = 'none';

      if (!email || !password) {
        if (errorMsgEl) {
          errorMsgEl.textContent = "Preencha o e-mail e a senha desejada para criar sua conta de gestor.";
          errorMsgEl.style.display = 'block';
        }
        return;
      }

      try {
        await realtimeEngine.signUp(email, password);
        showToast(`Conta criada com sucesso! Bem-vindo, ${email}!`);
        closeModal('adminLoginModal');
      } catch (err) {
        if (errorMsgEl) {
          errorMsgEl.textContent = err.message;
          errorMsgEl.style.display = 'block';
        }
      }
    });
  }

  const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
  if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener('click', async () => {
      const email = document.getElementById('loginEmail').value.trim();
      const errorMsgEl = document.getElementById('loginErrorMessage');
      if (!email) {
        if (errorMsgEl) {
          errorMsgEl.textContent = "Digite o seu e-mail de Gestor no campo acima e clique novamente em 'Esqueci minha senha'.";
          errorMsgEl.style.display = 'block';
        }
        return;
      }
      try {
        await realtimeEngine.sendPasswordReset(email);
        alert(`Um e-mail de redefinição de senha foi enviado para "${email}". Verifique sua caixa de entrada e pasta de spam.`);
      } catch (err) {
        if (errorMsgEl) {
          errorMsgEl.textContent = err.message;
          errorMsgEl.style.display = 'block';
        }
      }
    });
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await realtimeEngine.logout();
      showToast('Você saiu da conta de Gestor.');
    });
  }

  const bypassLoginBtn = document.getElementById('bypassLoginBtn');
  if (bypassLoginBtn) {
    bypassLoginBtn.addEventListener('click', () => {
      closeModal('adminLoginModal');
      showToast('Navegando no modo local (offline).');
    });
  }

  // Auth State Changed Listener
  realtimeEngine.onAuthStateChanged((user) => {
    const loginBtn = document.getElementById('loginModalBtn');
    const logoutBtnEl = document.getElementById('logoutBtn');

    if (user) {
      if (loginBtn) loginBtn.style.display = 'none';
      if (logoutBtnEl) {
        logoutBtnEl.style.display = 'inline-flex';
        logoutBtnEl.title = `Sair (${user.email})`;
      }
      closeModal('adminLoginModal');
    } else {
      if (loginBtn) loginBtn.style.display = 'inline-flex';
      if (logoutBtnEl) logoutBtnEl.style.display = 'none';
    }
  });

  // 9. Search Bar Handler with Debounce Optimization
  let searchDebounceTimeout = null;
  const searchInput = document.getElementById('searchInput');
  const searchClearBtn = document.getElementById('searchClearBtn');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout);
      searchDebounceTimeout = setTimeout(() => {
        currentPage = 1;
        renderProducts();
      }, 120);
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      searchQuery = '';
      currentPage = 1;
      renderProducts();
    });
  }

  // 10. Global Keyboard Shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+V)
  document.addEventListener('keydown', async (e) => {
    // Check if focused on input/textarea
    const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

    // Ctrl+Z (Undo)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !isTyping) {
      e.preventDefault();
      if (productStore.undo()) showToast('Desfeito (Ctrl+Z).');
    }

    // Ctrl+Y or Cmd+Shift+Z (Redo)
    if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
      if (!isTyping) {
        e.preventDefault();
        if (productStore.redo()) showToast('Refeito (Ctrl+Y).');
      }
    }
  });

  // Ctrl+V Paste Event Listener for Images
  document.addEventListener('paste', async (e) => {
    const isTextInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && 
                        document.activeElement.id !== 'excelPasteArea';

    // If typing in a regular text input (like search or title), allow normal text paste
    if (isTextInput && !document.getElementById('productModal').classList.contains('active')) {
      return;
    }

    const compressedImage = await ImageUtils.getPastedImage(e);
    if (!compressedImage) return;

    const productModal = document.getElementById('productModal');

    if (productModal && productModal.classList.contains('active')) {
      // Form modal is open
      currentBase64Image = compressedImage;
      const previewImg = document.getElementById('formImagePreview');
      const previewContainer = document.getElementById('imagePreviewContainer');
      if (previewImg && previewContainer) {
        previewImg.src = compressedImage;
        previewContainer.style.display = 'block';
        showToast('Foto colada no formulário com sucesso!');
      }
    } else if (!isClientMode) {
      // Target card selection: focusedCardProductId or first selected product
      let targetId = focusedCardProductId;
      if (!targetId && selectedProductIds.size > 0) {
        targetId = Array.from(selectedProductIds)[0];
      }

      if (targetId) {
        const prod = productStore.getProducts().find(p => p.id === targetId);
        productStore.updateProduct(targetId, { imageBase64: compressedImage });
        setActivePasteTarget(null); // Deselect target immediately after pasting
        showToast(`Foto colada no produto "${prod ? prod.description : ''}"!`);
      } else {
        showToast('Passe o mouse ou clique sobre um produto e pressione Ctrl+V para colar a foto.', 'error');
      }
    }
  });

  // 11. Subscribe Store Listener to Re-render UI
  productStore.subscribe(() => {
    syncPriceModeUI();
    renderCategoryPills();
    renderProducts();
  });

  // 12. Initial Kickoff
  checkMode();
  productStore.autoCategorizeAll(excelEngine);
  syncPriceModeUI();
  renderCategoryPills();
  renderProducts();
});
