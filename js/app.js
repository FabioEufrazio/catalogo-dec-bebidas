/* ==========================================================================
   Main Application Controller (app.js)
   Mode Handling, Rendering, Pagination, Keyboard Shortcuts & Event Handlers
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Category Definitions
  const CATEGORIES = [
    { id: 'all', label: 'Todos', icon: 'fa-layer-group' },
    { id: 'ofertas', label: 'Ofertas', icon: 'fa-fire', isPromo: true },
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
  let currentCategory = (window.location.hash === '#ofertas')
    ? 'ofertas'
    : (sessionStorage.getItem('catalog_current_category') || 'all');
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

  // Helper: Format Date BR (DD/MM/YYYY)
  function formatDateBR(dateStr) {
    if (!dateStr) return '';
    const parts = String(dateStr).split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
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
  function isManagerAuthenticated() {
    return localStorage.getItem('catalog_gestor_logged') === 'true';
  }

  function checkMode() {
    const params = new URLSearchParams(window.location.search);
    const forceClient = params.get('view') === 'public' || params.get('client') === '1';
    const isGestorAuth = isManagerAuthenticated();

    // Trava de segurança: somente exibe ferramentas de gestor se estiver autenticado e sem forceClient
    isClientMode = forceClient || !isGestorAuth;

    const titleEl = document.getElementById('appHeaderTitle');
    const logoutBtnEl = document.getElementById('logoutBtn');

    if (isClientMode) {
      document.body.classList.add('client-mode');
      document.documentElement.classList.add('client-mode');
      document.body.classList.remove('gestor-mode');
      document.documentElement.classList.remove('gestor-mode');
      if (titleEl) titleEl.textContent = 'Catálogo de Produtos';
      if (logoutBtnEl) logoutBtnEl.style.display = 'none';
    } else {
      document.body.classList.remove('client-mode');
      document.documentElement.classList.remove('client-mode');
      document.body.classList.add('gestor-mode');
      document.documentElement.classList.add('gestor-mode');
      if (titleEl) titleEl.textContent = 'Gestor de Catálogo';
      if (logoutBtnEl) {
        logoutBtnEl.style.display = 'inline-flex';
        const user = localStorage.getItem('catalog_gestor_user') || 'Gestor';
        logoutBtnEl.title = `Conectado como ${user}. Clique para sair do modo gestor.`;
      }
    }
  }

  // 3. Sync Price Mode UI Badges
  function syncPriceModeUI() {
    const hidePrices = productStore.getHidePrices();
    const html = document.documentElement;
    const body = document.body;

    // Os preços SÓ são ocultados na interface do cliente. O gestor sempre vê os preços.
    if (hidePrices && isClientMode) {
      html.classList.add('prices-hidden');
      body.classList.add('prices-hidden');
    } else {
      html.classList.remove('prices-hidden');
      body.classList.remove('prices-hidden');
    }

    const toggleBtn = document.getElementById('togglePricesBtn');

    if (toggleBtn) {
      if (hidePrices) {
        toggleBtn.innerHTML = '<i class="fa-solid fa-eye"></i> Exibir Preços (Clientes)';
        toggleBtn.style.borderColor = 'var(--accent-gold)';
        toggleBtn.style.color = 'var(--accent-gold)';
        toggleBtn.title = 'Preços estão OCULTOS para os clientes (mas visíveis para você no gestor). Clique para exibir aos clientes.';
      } else {
        toggleBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Ocultar Preços (Clientes)';
        toggleBtn.style.borderColor = '';
        toggleBtn.style.color = '';
        toggleBtn.title = 'Preços estão VISÍVEIS para os clientes. Clique para ocultar dos clientes.';
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
      // In client mode, hide empty categories (except 'all' and 'ofertas')
      if (cat.id !== 'all' && cat.id !== 'ofertas' && count === 0) return;

      const isPromoTab = cat.isPromo;
      const btn = document.createElement('button');
      btn.className = `pill-btn ${isPromoTab ? 'pill-promo' : ''} ${currentCategory === cat.id ? 'active' : ''}`;
      
      // Ofertas tab displays only the flame icon and label, without counter badge
      if (cat.id === 'ofertas') {
        btn.innerHTML = `
          <i class="fa-solid ${cat.icon}"></i>
          <span>${cat.label}</span>
        `;
      } else {
        btn.innerHTML = `
          <i class="fa-solid ${cat.icon}"></i>
          <span>${cat.label}</span>
          <span class="pill-count">${count}</span>
        `;
      }

      btn.addEventListener('click', () => {
        currentCategory = cat.id;
        sessionStorage.setItem('catalog_current_category', currentCategory);
        if (currentCategory === 'ofertas') {
          window.location.hash = 'ofertas';
        } else if (window.location.hash === '#ofertas') {
          history.replaceState(null, null, window.location.pathname + window.location.search);
        }
        currentPage = 1;
        renderCategoryPills();
        renderProducts();
      });

      container.appendChild(btn);
    });
  }

  // Helper: Extract brand/family cluster key from product description
  function getProductClusterKey(product) {
    if (!product) return 'OUTROS';
    const desc = String(product.description || '').toUpperCase();
    const category = String(product.category || '').toLowerCase();

    // 1. Specific High-Priority Brand / Product Lines (exact multi-word and prominent brands)
    const KNOWN_CLUSTERS = [
      // Ready to Drink / Ice
      { key: 'SMIRNOFF ICE', test: /(SMIRNOFF.*ICE|ICE.*SMIRNOFF)/i },
      { key: 'ICE 51', test: /(51.*ICE|ICE.*51)/i },
      { key: 'SKOL BEATS', test: /BEATS/i },

      // Energy Drinks
      { key: 'BALY', test: /\bBALY\b/i },
      { key: 'RED BULL', test: /\bRED\s*BULL\b/i },
      { key: 'MONSTER', test: /\bMONSTER\b/i },
      { key: 'TNT', test: /\bTNT\b/i },
      { key: 'FUSION', test: /\bFUSION\b/i },
      { key: 'EXTRA POWER', test: /\bEXTRA\s*POWER\b/i },
      { key: 'RED DUB', test: /\bRED\s*DUB\b/i },

      // Beers
      { key: 'HEINEKEN', test: /\bHEINEKEN\b/i },
      { key: 'AMSTEL', test: /\bAMSTEL\b/i },
      { key: 'CORONA', test: /\bCORONA\b/i },
      { key: 'BUDWEISER', test: /\bBUDWEISER\b/i },
      { key: 'STELLA ARTOIS', test: /\bSTELLA(\s*ARTOIS)?\b/i },
      { key: 'SPATEN', test: /\bSPATEN\b/i },
      { key: 'BRAHMA', test: /\bBRAHMA\b/i },
      { key: 'SKOL', test: /\bSKOL\b/i },
      { key: 'EISENBAHN', test: /\bEISENBAHN\b/i },
      { key: 'ORIGINAL', test: /\bORIGINAL\b/i },
      { key: 'BECKS', test: /\bBECK'?S\b/i },
      { key: 'IMPÉRIO', test: /\bIMPERIO\b/i },
      { key: 'PETRA', test: /\bPETRA\b/i },
      { key: 'DEVASSA', test: /\bDEVASSA\b/i },
      { key: 'ITAIPAVA', test: /\bITAIPAVA\b/i },

      // Whiskies
      { key: 'JACK DANIELS', test: /\bJACK\s*DANIEL'?S?\b/i },
      { key: 'JOHNNIE WALKER', test: /(JOHNNIE\s*WALKER|RED\s*LABEL|BLACK\s*LABEL|GOLD\s*LABEL|BLUE\s*LABEL|GREEN\s*LABEL)/i },
      { key: 'CHIVAS REGAL', test: /\bCHIVAS(\s*REGAL)?\b/i },
      { key: 'BALLANTINES', test: /\bBALLANTINE'?S?\b/i },
      { key: 'OLD PARR', test: /\bOLD\s*PARR\b/i },
      { key: 'WHITE HORSE', test: /\bWHITE\s*HORSE\b/i },
      { key: 'BLACK & WHITE', test: /(BLACK\s*(&|E)?\s*WHITE)/i },
      { key: 'PASSPORT', test: /\bPASSPORT\b/i },
      { key: 'BUCHANANS', test: /\bBUCHANAN'?S?\b/i },
      { key: 'JAMESON', test: /\bJAMESON\b/i },
      { key: 'GRANT', test: /\bGRANT'?S?\b/i },
      { key: 'TEACHERS', test: /\bTEACHER'?S?\b/i },
      { key: 'BELLS', test: /\bBELL'?S?\b/i },
      { key: 'NATU NOBILIS', test: /\bNATU\s*NOBILIS\b/i },

      // Vodkas
      { key: 'SMIRNOFF', test: /\bSMIRNOFF\b/i },
      { key: 'ABSOLUT', test: /\bABSOLUT\b/i },
      { key: 'CIROC', test: /\bCIROC\b/i },
      { key: 'GREY GOOSE', test: /\bGREY\s*GOOSE\b/i },
      { key: 'BELVEDERE', test: /\bBELVEDERE\b/i },
      { key: 'ORLOFF', test: /\bORLOFF\b/i },
      { key: 'ASKOV', test: /\bASKOV\b/i },
      { key: 'KOBLEVO', test: /\bKOBLEVO\b/i },

      // Gins
      { key: 'TANQUERAY', test: /\bTANQUERAY\b/i },
      { key: 'BEEFEATER', test: /\bBEEFEATER\b/i },
      { key: 'BOMBAY', test: /\bBOMBAY(\s*SAPPHIRE)?\b/i },
      { key: 'GORDONS', test: /\bGORDON'?S?\b/i },
      { key: 'SEAGERS', test: /\bSEAGERS?\b/i },
      { key: 'BULLDOG', test: /\bBULLDOG\b/i },
      { key: 'HENDRICKS', test: /\bHENDRICK'?S?\b/i },
      { key: 'ROCKS', test: /\bROCKS?\b/i },

      // Liqueurs / Aperitifs
      { key: 'CAMPARI', test: /\bCAMPARI\b/i },
      { key: 'APEROL', test: /\bAPEROL\b/i },
      { key: 'JAGERMEISTER', test: /\bJ(A|Ä)GERMEISTER\b/i },
      { key: 'LICOR 43', test: /(LICOR\s*43|CUARENTA\s*Y\s*TRES)/i },
      { key: 'BAILEYS', test: /\bBAILEY'?S?\b/i },
      { key: 'AMARETTO', test: /\bAMARETTO\b/i },
      { key: 'COINTREAU', test: /\bCOINTREAU\b/i },

      // Rums / Cachaças
      { key: 'BACARDI', test: /\bBACARDI\b/i },
      { key: 'MONTILLA', test: /\bMONTILLA\b/i },
      { key: 'MALIBU', test: /\bMALIBU\b/i },
      { key: 'HAVANA CLUB', test: /\bHAVANA(\s*CLUB)?\b/i },
      { key: '51', test: /\b51\b/i },
      { key: 'PITU', test: /\bPITU\b/i },
      { key: 'YPIOCA', test: /\bYPIOCA\b/i },
      { key: 'SAGATIBA', test: /\bSAGATIBA\b/i },
      { key: 'VELHO BARREIRO', test: /\bVELHO\s*BARREIRO\b/i },

      // Tequilas
      { key: 'JOSE CUERVO', test: /\b(JOSE\s*)?CUERVO\b/i },

      // Syrups
      { key: 'MONIN', test: /\bMONIN\b/i },
      { key: '1883', test: /\b1883\b/i },
      { key: 'KALY', test: /\bKALY\b/i },

      // Sodas / Non-Alcoholic
      { key: 'COCA-COLA', test: /(COCA\s*-?\s*COLA)/i },
      { key: 'PEPSI', test: /\bPEPSI\b/i },
      { key: 'GUARANA ANTARCTICA', test: /(GUARAN[AA]\s*ANTARCTICA|ANTARCTICA\s*GUARAN[AA])/i },
      { key: 'SCHWEPPES', test: /\bSCHWEPPES\b/i },
      { key: 'SPRITE', test: /\bSPRITE\b/i },
      { key: 'FANTA', test: /\bFANTA\b/i },
      { key: 'H2OH', test: /\bH2OH!?\b/i },
      { key: 'SUCO PRATS', test: /\bPRATS\b/i },
      { key: 'DEL VALLE', test: /\bDEL\s*VALLE\b/i }
    ];

    for (const cluster of KNOWN_CLUSTERS) {
      if (cluster.test.test(desc)) {
        return cluster.key;
      }
    }

    // 2. Generic Heuristic for unlisted brands/products:
    // Strip categories, package types, sizes, and stop words to group by brand tokens
    let clean = desc
      .replace(/\b(WHISKY|WHISKEY|VODKA|GIN|CERVEJA|CHOPP|ENERGETICO|ENERGÉTICO|VINHO|ESPUMANTE|LICOR|REFRIGERANTE|SUCO|XAROPE|AGUA|ÁGUA|BEBIDA MISTA|BEBIDA|ICE)\b/gi, ' ')
      .replace(/\b(LATA|LATÃO|LONG NECK|LN|GF|GARRAFA|PET|PACK|FARDO|CX|CAIXA|RETORN[AÁ]VEL|DESCART[AÁ]VEL)\b/gi, ' ')
      .replace(/\b\d+(\.\d+)?\s*(ML|L|LT|LITRO|LITROS|G|KG)\b/gi, ' ')
      .replace(/\b(DE|DO|DA|DOS|DAS|COM|EM|E|SEM|ALCOOL|ÁLCOOL|ZERO)\b/gi, ' ')
      .replace(/[^A-Z0-9\s]/g, ' ')
      .trim();

    const words = clean.split(/\s+/).filter(w => w.length > 2);
    if (words.length >= 2) {
      return `${words[0]} ${words[1]}`;
    } else if (words.length === 1) {
      return words[0];
    }

    return (category || 'OUTROS').toUpperCase();
  }

  // 4.5. Lâminas e Encartes de Ofertas Controller
  let viewerIsZoomed = false;

  function renderLaminas() {
    const laminasGrid = document.getElementById('laminasGrid');
    if (!laminasGrid) return;

    const laminas = productStore.getLaminas();
    if (laminas.length === 0) {
      laminasGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 20px;">
          <i class="fa-solid fa-newspaper" style="color: var(--accent-gold); font-size: 2.5rem; margin-bottom: 12px;"></i>
          <h3>Nenhum encarte de ofertas cadastrado</h3>
          <p>Novos encartes e lâminas de promoções aparecerão aqui com destaque.</p>
        </div>
      `;
      return;
    }

    const isGestor = !isClientMode && (localStorage.getItem('catalog_gestor_logged') === 'true');
    const fragment = document.createDocumentFragment();

    laminas.forEach(lamina => {
      const card = document.createElement('article');
      card.className = 'lamina-card';
      card.dataset.id = lamina.id;

      card.innerHTML = `
        <div class="lamina-img-container">
          <img src="${lamina.imageUrl}" alt="${lamina.title}" class="lamina-img" loading="lazy">
        </div>
        ${isGestor ? `
          <div class="lamina-card-body" style="padding: 10px 14px; display: flex; justify-content: space-between; align-items: center;">
            <h4 class="lamina-card-title" style="font-size: 0.95rem; margin: 0;">${lamina.title}</h4>
            <button type="button" class="btn btn-danger btn-sm lamina-btn-delete" title="Excluir Encarte">
              <i class="fa-solid fa-trash-can"></i> Excluir
            </button>
          </div>
        ` : ''}
      `;

      const deleteBtn = card.querySelector('.lamina-btn-delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`Tem certeza que deseja excluir o encarte "${lamina.title}"?`)) {
            productStore.deleteLamina(lamina.id);
            renderLaminas();
            showToast('Encarte excluído com sucesso.', 'info');
          }
        });
      }

      fragment.appendChild(card);
    });

    laminasGrid.replaceChildren(fragment);
  }

  function openLaminaViewer(lamina) {
    const modal = document.getElementById('laminaViewerModal');
    const titleEl = document.getElementById('viewerLaminaTitle');
    const validityEl = document.getElementById('viewerLaminaValidity');
    const imgEl = document.getElementById('viewerLaminaImg');
    const whatsAppBtn = document.getElementById('viewerOrderWhatsAppBtn');
    const zoomInBtn = document.getElementById('viewerZoomInBtn');

    if (!modal || !imgEl) return;

    if (titleEl) titleEl.textContent = lamina.title || 'Encarte de Ofertas';
    if (validityEl) {
      validityEl.textContent = lamina.validity ? `Validade: ${lamina.validity}` : '';
      validityEl.style.display = lamina.validity ? 'inline-block' : 'none';
    }
    imgEl.src = lamina.imageUrl;
    imgEl.classList.remove('is-zoomed');
    viewerIsZoomed = false;
    if (zoomInBtn) zoomInBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass-plus"></i>';

    if (whatsAppBtn) {
      const msg = encodeURIComponent(`Olá! Gostaria de fazer um pedido com base nas ofertas do encarte "${lamina.title}".`);
      whatsAppBtn.href = `https://wa.me/5581999999999?text=${msg}`;
    }

    modal.classList.add('is-open');
  }

  function setupLaminaViewerEvents() {
    const imgEl = document.getElementById('viewerLaminaImg');
    const zoomInBtn = document.getElementById('viewerZoomInBtn');
    const zoomResetBtn = document.getElementById('viewerZoomResetBtn');

    const toggleZoom = () => {
      if (!imgEl) return;
      viewerIsZoomed = !viewerIsZoomed;
      imgEl.classList.toggle('is-zoomed', viewerIsZoomed);
      if (zoomInBtn) {
        zoomInBtn.innerHTML = viewerIsZoomed 
          ? '<i class="fa-solid fa-magnifying-glass-minus"></i>' 
          : '<i class="fa-solid fa-magnifying-glass-plus"></i>';
      }
    };

    if (imgEl) imgEl.addEventListener('click', toggleZoom);
    if (zoomInBtn) zoomInBtn.addEventListener('click', toggleZoom);
    if (zoomResetBtn) {
      zoomResetBtn.addEventListener('click', () => {
        if (!imgEl) return;
        viewerIsZoomed = false;
        imgEl.classList.remove('is-zoomed');
        if (zoomInBtn) zoomInBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass-plus"></i>';
      });
    }
  }

  let newLaminaBase64 = '';

  function setupAddLaminaModalEvents() {
    const addBtn = document.getElementById('addNewLaminaBtn');
    const modal = document.getElementById('addLaminaModal');
    const form = document.getElementById('addLaminaForm');
    const dropzone = document.getElementById('laminaUploadDropzone');
    const fileInput = document.getElementById('laminaFileInput');
    const previewContainer = document.getElementById('laminaFilePreviewContainer');
    const previewImg = document.getElementById('laminaPreviewImg');
    const removePreviewBtn = document.getElementById('removeLaminaPreviewBtn');

    if (addBtn && modal) {
      addBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (form) form.reset();
        newLaminaBase64 = '';
        if (previewContainer) previewContainer.style.display = 'none';
        if (dropzone) dropzone.style.display = 'flex';
        modal.classList.add('active');
      });
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('active');
        }
      });
    }

    const handleFile = (file) => {
      if (!file || !file.type.startsWith('image/')) {
        showToast('Por favor, selecione um arquivo de imagem válido.', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        newLaminaBase64 = e.target.result;
        if (previewImg) previewImg.src = newLaminaBase64;
        if (previewContainer) previewContainer.style.display = 'block';
        if (dropzone) dropzone.style.display = 'none';
      };
      reader.readAsDataURL(file);
    };

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          handleFile(e.target.files[0]);
        }
      });

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = 'var(--accent-gold)';
      });
      dropzone.addEventListener('dragleave', () => {
        dropzone.style.borderColor = 'var(--border-color)';
      });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = 'var(--border-color)';
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleFile(e.dataTransfer.files[0]);
        }
      });
    }

    if (removePreviewBtn) {
      removePreviewBtn.addEventListener('click', () => {
        newLaminaBase64 = '';
        if (fileInput) fileInput.value = '';
        if (previewContainer) previewContainer.style.display = 'none';
        if (dropzone) dropzone.style.display = 'flex';
      });
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!newLaminaBase64) {
          showToast('Por favor, selecione ou arraste a imagem do encarte.', 'error');
          return;
        }

        const titleInput = document.getElementById('laminaTitleInput');
        const validityInput = document.getElementById('laminaValidityInput');
        const title = titleInput ? titleInput.value.trim() : '';
        const validity = validityInput ? validityInput.value.trim() : '';

        const newLamina = {
          id: 'LAM_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          title: title || 'Encarte Promocional',
          imageUrl: newLaminaBase64,
          validity: validity,
          description: '',
          active: true,
          createdAt: new Date().toISOString()
        };

        productStore.addLamina(newLamina);
        modal.classList.remove('active');
        renderLaminas();
        showToast('Novo encarte de ofertas adicionado com sucesso!', 'success');
      });
    }
  }

  // 5. Render Product Grid & Pagination
  function renderProducts() {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;

    let products = productStore.getProducts();

    // When inside the dedicated "Ofertas" tab:
    // Display the Laminas / Encartes de Ofertas gallery!
    const laminasSection = document.getElementById('laminasSection');
    const paginationContainer = document.getElementById('paginationContainer');
    const ofertasBanner = document.getElementById('ofertasBanner');

    if (currentCategory === 'ofertas') {
      grid.style.display = 'none';
      if (paginationContainer) paginationContainer.style.display = 'none';
      if (laminasSection) {
        laminasSection.style.display = 'block';
        renderLaminas();
      }
      if (ofertasBanner) ofertasBanner.style.display = 'none';

      // Update Header Total Badge
      const headerBadge = document.getElementById('headerTotalBadge');
      if (headerBadge) {
        const count = productStore.getLaminas().length;
        headerBadge.textContent = `${count} ${count === 1 ? 'encarte' : 'encartes'}`;
      }
      return;
    } else {
      grid.style.display = '';
      if (paginationContainer) paginationContainer.style.display = '';
      if (laminasSection) laminasSection.style.display = 'none';
      grid.classList.remove('ofertas-active-view');
      if (ofertasBanner) ofertasBanner.style.display = 'none';
    }

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

    // Always preserve the natural order (POS) defined by the user in general views!
    products.sort((a, b) => (a.manualPosition || 999999) - (b.manualPosition || 999999));

    // Update Header Total Badge
    const headerBadge = document.getElementById('headerTotalBadge');
    if (headerBadge) {
      headerBadge.textContent = `${products.length} ${products.length === 1 ? 'item' : 'itens'}`;
    }

    if (products.length === 0) {
      if (currentCategory === 'ofertas') {
        grid.innerHTML = `
          <div class="empty-state">
            <i class="fa-solid fa-fire" style="color: #ef4444;"></i>
            <h3>Nenhum produto em oferta no momento</h3>
            <p>Quando produtos forem colocados em oferta com prazo, eles aparecerão com destaque exclusivo nesta aba.</p>
          </div>
        `;
      } else {
        grid.innerHTML = `
          <div class="empty-state">
            <i class="fa-solid fa-wine-bottle"></i>
            <h3>Nenhum produto encontrado</h3>
            <p>Tente ajustar os filtros de categoria ou busca.</p>
          </div>
        `;
      }
      renderPagination(0);
      return;
    }

    // Pagination Calculation
    const totalPages = Math.ceil(products.length / itemsPerPage);
    currentPage = Math.max(1, Math.min(currentPage, totalPages));

    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedProducts = products.slice(startIndex, startIndex + itemsPerPage);

    // Atomic DOM replacement: avoids white screen flash and preserves smooth interactions
    const fragment = document.createDocumentFragment();
    paginatedProducts.forEach(product => {
      const card = createProductCard(product);
      fragment.appendChild(card);
    });
    grid.replaceChildren(fragment);

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

    card.addEventListener('mouseenter', () => {
      if (!isClientMode) {
        focusedCardProductId = p.id;
      }
    });

    const boxTotal = p.unitPrice * p.qtyPerBox;
    const catLabel = (CATEGORIES.find(c => c.id === p.category) || {}).label || 'Outros';

    card.innerHTML = `
      <!-- Admin Bar -->
      <div class="product-card-admin-bar admin-only-ui">
        <div class="product-checkbox-wrapper">
          <input type="checkbox" class="product-checkbox" ${selectedProductIds.has(p.id) ? 'checked' : ''}>
          <div class="pos-badge-wrapper">
            <span>POS:</span>
            <input type="text" inputmode="numeric" class="pos-badge-input" value="${p.manualPosition}">
          </div>
        </div>
        <div class="product-actions-bar">
          <button class="icon-action-btn toggle-active-btn" title="${p.active ? 'Produto Ativo (Visível para clientes). Clique para ocultar do cliente.' : 'Produto Oculto/Desativado! Clique para ativar e exibir aos clientes.'}">
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
        <div class="product-corner-badges">
          <span class="category-tag">${catLabel}</span>
        </div>
        ${!p.active ? `<span class="inactive-status-tag admin-only-ui"><i class="fa-solid fa-eye-slash"></i> Oculto no Cliente</span>` : ''}
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

    // Otimização de Fluidez para o Cliente: pula a atribuição de +20 listeners de edição por card
    if (isClientMode) {
      const imgEl = card.querySelector('.product-img');
      if (imgEl) {
        imgEl.style.cursor = 'pointer';
        imgEl.addEventListener('click', () => openImageLightbox(p));
      }
      return card;
    }

    // Event Listeners on Card Elements (Apenas no Modo Gestor)

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
      let isEditing = false;

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

      posWrapper.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const res = prompt(`Digite a nova posição para "${p.description}" (Atual: ${p.manualPosition}):`, p.manualPosition);
        if (res !== null) {
          const val = parseInt(res.trim());
          if (!isNaN(val) && val > 0 && val !== p.manualPosition) {
            productStore.reorderProduct(p.id, val);
            showToast(`Posição de "${p.description}" alterada para ${val}.`);
          }
        }
      });

      posInput.addEventListener('focus', (e) => {
        e.stopPropagation();
        isEditing = true;
        posInput.select(); // Highlight entire text for instant typing
      });

      const commitChange = () => {
        if (!isEditing) return;
        isEditing = false;
        const val = parseInt(posInput.value.trim());
        if (!isNaN(val) && val > 0 && val !== p.manualPosition) {
          productStore.reorderProduct(p.id, val);
          showToast(`Posição de "${p.description}" alterada para ${val}.`);
        } else {
          posInput.value = p.manualPosition; // reset if invalid or unchanged
        }
        posInput.blur();
      };

      posInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitChange();
        } else if (e.key === 'Escape') {
          isEditing = false;
          posInput.value = p.manualPosition;
          posInput.blur();
        }
      });

      posInput.addEventListener('blur', () => {
        commitChange();
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

    // 8. Click on Price Box to quickly edit price (Admin Mode)
    const priceBox = card.querySelector('.price-details-box');
    if (priceBox && !isClientMode) {
      priceBox.style.cursor = 'pointer';
      priceBox.title = 'Clique para editar o preço deste produto';
      priceBox.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditProductModal(p);
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

  // Promo Modal Handlers
  let currentPromoProduct = null;

  function openPromoModal(product) {
    currentPromoProduct = product;
    if (!product) return;

    const titleEl = document.getElementById('promoProductTitle');
    const origPriceEl = document.getElementById('promoOriginalPriceText');
    const idInput = document.getElementById('promoProductId');
    const priceInput = document.getElementById('promoPriceInput');
    const expiryInput = document.getElementById('promoExpiryInput');
    const removeBtn = document.getElementById('removePromoBtn');

    if (titleEl) titleEl.textContent = product.description;
    if (origPriceEl) origPriceEl.textContent = formatCurrency(product.unitPrice);
    if (idInput) idInput.value = product.id;

    // Set min date to today (YYYY-MM-DD)
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    if (expiryInput) {
      expiryInput.min = todayStr;
      expiryInput.value = product.promoExpiry || '';
    }

    const isPromo = productStore.isProductPromoActive(product);
    if (priceInput) {
      priceInput.value = isPromo && product.promoPrice ? product.promoPrice : '';
    }

    if (removeBtn) {
      removeBtn.style.display = isPromo ? 'inline-flex' : 'none';
    }

    updatePromoPreview();
    openModal('promoModal');
  }

  function updatePromoPreview() {
    if (!currentPromoProduct) return;
    const priceInput = document.getElementById('promoPriceInput');
    const previewBox = document.getElementById('promoPreviewBox');
    const badgeEl = document.getElementById('promoDiscountBadge');
    const savingsEl = document.getElementById('promoSavingsText');

    const promoVal = parseFloat(priceInput ? priceInput.value : 0);
    const origVal = parseFloat(currentPromoProduct.unitPrice) || 0;

    if (promoVal > 0 && origVal > 0 && promoVal < origVal) {
      const discount = Math.round(((origVal - promoVal) / origVal) * 100);
      const savings = origVal - promoVal;
      if (badgeEl) badgeEl.textContent = `-${discount}% OFF`;
      if (savingsEl) savingsEl.textContent = formatCurrency(savings);
      if (previewBox) previewBox.style.display = 'block';
    } else {
      if (previewBox) previewBox.style.display = 'none';
    }
  }

  const promoPriceInput = document.getElementById('promoPriceInput');
  if (promoPriceInput) {
    promoPriceInput.addEventListener('input', updatePromoPreview);
  }

  const promoForm = document.getElementById('promoForm');
  if (promoForm) {
    promoForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!currentPromoProduct) return;

      const id = document.getElementById('promoProductId').value;
      const priceVal = parseFloat(document.getElementById('promoPriceInput').value);
      const expiryVal = document.getElementById('promoExpiryInput').value;

      if (isNaN(priceVal) || priceVal <= 0) {
        showToast('Informe um preço promocional válido.', 'error');
        return;
      }

      if (priceVal >= currentPromoProduct.unitPrice) {
        showToast('O preço promocional deve ser menor que o preço normal.', 'error');
        return;
      }

      if (!expiryVal) {
        showToast('Informe a data de validade da oferta.', 'error');
        return;
      }

      productStore.setProductPromo(id, {
        active: true,
        price: priceVal,
        expiry: expiryVal
      });

      showToast(`Oferta salva para "${currentPromoProduct.description}" até ${formatDateBR(expiryVal)}!`);
      closeModal('promoModal');
    });
  }

  const removePromoBtn = document.getElementById('removePromoBtn');
  if (removePromoBtn) {
    removePromoBtn.addEventListener('click', () => {
      if (!currentPromoProduct) return;
      productStore.setProductPromo(currentPromoProduct.id, { active: false });
      showToast(`Oferta encerrada. "${currentPromoProduct.description}" voltou ao preço normal.`);
      closeModal('promoModal');
    });
  }

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

  // Bulk Select All / Deselect All
  const bulkSelectAllBtn = document.getElementById('bulkSelectAllBtn');
  if (bulkSelectAllBtn) {
    bulkSelectAllBtn.addEventListener('click', () => {
      const allProds = productStore.getProducts().filter(p => !isClientMode || p.active);
      if (selectedProductIds.size === allProds.length) {
        selectedProductIds.clear();
        showToast('Seleção desmarcada.');
      } else {
        allProds.forEach(p => selectedProductIds.add(p.id));
        showToast(`${allProds.length} produtos selecionados.`);
      }
      renderProducts();
    });
  }

  // Bulk Promo Modal & Actions Handlers
  const bulkPromoBtn = document.getElementById('bulkPromoBtn');
  const bulkPromoDiscountType = document.getElementById('bulkPromoDiscountType');
  const bulkPromoValueInput = document.getElementById('bulkPromoValueInput');
  const bulkPromoValueLabel = document.getElementById('bulkPromoValueLabel');
  const bulkPromoExpiryInput = document.getElementById('bulkPromoExpiryInput');
  const bulkPromoPreviewTableBody = document.getElementById('bulkPromoPreviewTableBody');
  const bulkPromoModeTabApply = document.getElementById('bulkPromoModeTabApply');
  const bulkPromoModeTabRemove = document.getElementById('bulkPromoModeTabRemove');
  const bulkPromoApplySection = document.getElementById('bulkPromoApplySection');
  const bulkPromoRemoveSection = document.getElementById('bulkPromoRemoveSection');
  const confirmBulkPromoBtn = document.getElementById('confirmBulkPromoBtn');
  const bulkPromoCountLabel = document.getElementById('bulkPromoCountLabel');

  let bulkPromoMode = 'apply'; // 'apply' | 'remove'

  function updateBulkPromoPreview() {
    if (!bulkPromoPreviewTableBody) return;
    bulkPromoPreviewTableBody.innerHTML = '';

    const ids = Array.from(selectedProductIds);
    const selectedProds = productStore.getProducts().filter(p => ids.includes(p.id));
    const type = bulkPromoDiscountType ? bulkPromoDiscountType.value : 'percent';
    const val = parseFloat(bulkPromoValueInput ? bulkPromoValueInput.value : 0) || 0;

    selectedProds.slice(0, 15).forEach(p => {
      let promoPrice = p.unitPrice;
      if (val > 0) {
        if (type === 'percent') {
          promoPrice = Math.max(0.01, p.unitPrice * (1 - val / 100));
        } else if (type === 'discount_fixed') {
          promoPrice = Math.max(0.01, p.unitPrice - val);
        } else if (type === 'fixed_price') {
          promoPrice = Math.max(0.01, val);
        }
      }

      const discountPercent = p.unitPrice > 0 && promoPrice < p.unitPrice
        ? Math.round(((p.unitPrice - promoPrice) / p.unitPrice) * 100)
        : 0;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${p.description}</strong></td>
        <td>${formatCurrency(p.unitPrice)}</td>
        <td><strong style="color:#ef4444;">${val > 0 ? formatCurrency(promoPrice) : '-'}</strong></td>
        <td>${discountPercent > 0 ? `<span class="badge badge-active" style="background:rgba(239,68,68,0.2); color:#ef4444;">-${discountPercent}%</span>` : '-'}</td>
      `;
      bulkPromoPreviewTableBody.appendChild(tr);
    });

    if (selectedProds.length > 15) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="4" style="text-align:center; color:var(--text-muted); font-size:0.8rem;">... e mais ${selectedProds.length - 15} produtos selecionados</td>`;
      bulkPromoPreviewTableBody.appendChild(tr);
    }
  }

  function setDateOffsetDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    if (bulkPromoExpiryInput) bulkPromoExpiryInput.value = `${yyyy}-${mm}-${dd}`;
  }

  if (bulkPromoBtn) {
    bulkPromoBtn.addEventListener('click', () => {
      const count = selectedProductIds.size;
      if (count === 0) {
        showToast('Selecione pelo menos um produto para aplicar oferta em lote.', 'error');
        return;
      }

      if (bulkPromoCountLabel) {
        bulkPromoCountLabel.textContent = `${count} ${count === 1 ? 'produto' : 'produtos'}`;
      }

      // Min date is today
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      if (bulkPromoExpiryInput) {
        bulkPromoExpiryInput.min = todayStr;
        if (!bulkPromoExpiryInput.value) setDateOffsetDays(7); // Default 7 days
      }

      // Reset to apply mode
      bulkPromoMode = 'apply';
      if (bulkPromoModeTabApply) {
        bulkPromoModeTabApply.className = 'btn btn-primary';
        bulkPromoModeTabRemove.className = 'btn btn-outline';
      }
      if (bulkPromoApplySection) bulkPromoApplySection.style.display = 'block';
      if (bulkPromoRemoveSection) bulkPromoRemoveSection.style.display = 'none';
      if (confirmBulkPromoBtn) {
        confirmBulkPromoBtn.className = 'btn btn-primary';
        confirmBulkPromoBtn.style.background = 'linear-gradient(135deg, #ef4444, #f97316)';
        confirmBulkPromoBtn.innerHTML = '<i class="fa-solid fa-fire"></i> Confirmar Oferta em Lote';
      }

      updateBulkPromoPreview();
      openModal('bulkPromoModal');
    });
  }

  if (bulkPromoModeTabApply) {
    bulkPromoModeTabApply.addEventListener('click', () => {
      bulkPromoMode = 'apply';
      bulkPromoModeTabApply.className = 'btn btn-primary';
      bulkPromoModeTabRemove.className = 'btn btn-outline';
      if (bulkPromoApplySection) bulkPromoApplySection.style.display = 'block';
      if (bulkPromoRemoveSection) bulkPromoRemoveSection.style.display = 'none';
      if (confirmBulkPromoBtn) {
        confirmBulkPromoBtn.className = 'btn btn-primary';
        confirmBulkPromoBtn.style.background = 'linear-gradient(135deg, #ef4444, #f97316)';
        confirmBulkPromoBtn.innerHTML = '<i class="fa-solid fa-fire"></i> Confirmar Oferta em Lote';
      }
    });
  }

  if (bulkPromoModeTabRemove) {
    bulkPromoModeTabRemove.addEventListener('click', () => {
      bulkPromoMode = 'remove';
      bulkPromoModeTabRemove.className = 'btn btn-danger';
      bulkPromoModeTabApply.className = 'btn btn-outline';
      if (bulkPromoApplySection) bulkPromoApplySection.style.display = 'none';
      if (bulkPromoRemoveSection) bulkPromoRemoveSection.style.display = 'block';
      if (confirmBulkPromoBtn) {
        confirmBulkPromoBtn.className = 'btn btn-danger';
        confirmBulkPromoBtn.style.background = '';
        confirmBulkPromoBtn.innerHTML = '<i class="fa-solid fa-ban"></i> Remover Ofertas dos Selecionados';
      }
    });
  }

  if (bulkPromoDiscountType) {
    bulkPromoDiscountType.addEventListener('change', () => {
      const t = bulkPromoDiscountType.value;
      if (t === 'percent') {
        bulkPromoValueLabel.textContent = 'Percentual de Desconto (%)';
        bulkPromoValueInput.placeholder = 'Ex: 15';
      } else if (t === 'discount_fixed') {
        bulkPromoValueLabel.textContent = 'Abatimento Fixo por Unidade (R$)';
        bulkPromoValueInput.placeholder = 'Ex: 5.00';
      } else if (t === 'fixed_price') {
        bulkPromoValueLabel.textContent = 'Preço Promocional Único (R$)';
        bulkPromoValueInput.placeholder = 'Ex: 29.90';
      }
      updateBulkPromoPreview();
    });
  }

  if (bulkPromoValueInput) {
    bulkPromoValueInput.addEventListener('input', updateBulkPromoPreview);
  }

  document.querySelectorAll('.promo-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.getAttribute('data-days') || 7);
      setDateOffsetDays(days);
    });
  });

  if (confirmBulkPromoBtn) {
    confirmBulkPromoBtn.addEventListener('click', () => {
      const ids = Array.from(selectedProductIds);
      if (ids.length === 0) return;

      if (bulkPromoMode === 'remove') {
        productStore.bulkRemovePromo(ids);
        showToast(`Ofertas encerradas para ${ids.length} produtos.`);
        closeModal('bulkPromoModal');
        selectedProductIds.clear();
        renderProducts();
        return;
      }

      // Apply mode
      const type = bulkPromoDiscountType ? bulkPromoDiscountType.value : 'percent';
      const val = parseFloat(bulkPromoValueInput ? bulkPromoValueInput.value : 0);
      const expiry = bulkPromoExpiryInput ? bulkPromoExpiryInput.value : '';

      if (isNaN(val) || val <= 0) {
        showToast('Informe um valor de desconto válido maior que zero.', 'error');
        return;
      }

      if (type === 'percent' && val >= 100) {
        showToast('O desconto percentual deve ser menor que 100%.', 'error');
        return;
      }

      if (!expiry) {
        showToast('Informe o prazo / data de validade da oferta.', 'error');
        return;
      }

      const changed = productStore.bulkSetPromo(ids, {
        type,
        value: val,
        expiry
      });

      if (changed) {
        showToast(`Oferta em lote aplicada com sucesso para ${ids.length} produtos até ${formatDateBR(expiry)}!`);
      } else {
        showToast('Nenhum produto pôde receber a oferta (verifique se os preços eram válidos).', 'warning');
      }

      closeModal('bulkPromoModal');
      selectedProductIds.clear();
      renderProducts();
    });
  }

  // ==========================================================================
  // 7.5. QUICK OFFER TABLE CONTROLLER (Criar Ofertas Rápidas em Tabela)
  // ==========================================================================
  const quickOfferTableBtn = document.getElementById('quickOfferTableBtn');
  const quickOfferSearchInput = document.getElementById('quickOfferSearchInput');
  const quickOfferSearchClearBtn = document.getElementById('quickOfferSearchClearBtn');
  const quickOfferSearchResults = document.getElementById('quickOfferSearchResults');
  const quickOfferTableBody = document.getElementById('quickOfferTableBody');
  const quickOfferTableEmpty = document.getElementById('quickOfferTableEmpty');
  const quickOfferCountBadge = document.getElementById('quickOfferCountBadge');
  const quickOfferClearTableBtn = document.getElementById('quickOfferClearTableBtn');
  const quickOfferBatchDateInput = document.getElementById('quickOfferBatchDateInput');
  const quickOfferApplyDateToAllBtn = document.getElementById('quickOfferApplyDateToAllBtn');
  const quickOfferLoadActiveBtn = document.getElementById('quickOfferLoadActiveBtn');
  const publishQuickOffersBtn = document.getElementById('publishQuickOffersBtn');

  // Map of productId -> { product, promoPrice, promoExpiry }
  const quickOfferItems = new Map();

  function updateQuickOfferTableUI() {
    if (!quickOfferTableBody) return;
    quickOfferTableBody.innerHTML = '';

    const count = quickOfferItems.size;
    if (quickOfferCountBadge) {
      quickOfferCountBadge.textContent = `${count} ${count === 1 ? 'produto' : 'produtos'}`;
    }

    if (count === 0) {
      if (quickOfferTableEmpty) quickOfferTableEmpty.style.display = 'block';
      if (quickOfferClearTableBtn) quickOfferClearTableBtn.style.display = 'none';
      return;
    }

    if (quickOfferTableEmpty) quickOfferTableEmpty.style.display = 'none';
    if (quickOfferClearTableBtn) quickOfferClearTableBtn.style.display = 'inline-flex';

    quickOfferItems.forEach((item, id) => {
      const p = item.product;
      const tr = document.createElement('tr');
      tr.dataset.id = id;

      const regularPrice = parseFloat(p.unitPrice) || 0;
      const currentPromo = parseFloat(item.promoPrice) || (regularPrice > 0 ? Number((regularPrice * 0.85).toFixed(2)) : 0);
      item.promoPrice = currentPromo;

      const discountPct = regularPrice > 0 && currentPromo < regularPrice 
        ? Math.round(((regularPrice - currentPromo) / regularPrice) * 100)
        : 0;

      tr.innerHTML = `
        <td>
          <div class="quick-offer-row-product">
            <div>
              <div style="font-weight:600; color:var(--text-primary); line-height:1.25; font-size:0.88rem;">${p.description}</div>
              <div style="font-size:0.75rem; color:var(--text-muted); margin-top:3px; display:flex; align-items:center; gap:6px;">
                ${p.code ? `<span class="badge" style="font-size:0.68rem; padding:2px 6px;">SKU: ${p.code}</span>` : ''}
                <span>${(CATEGORIES.find(c => c.id === p.category) || {}).label || 'Outros'}</span>
              </div>
            </div>
          </div>
        </td>
        <td style="font-weight:600; color:var(--text-muted);">
          ${formatCurrency(regularPrice)}
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:4px;">
            <span style="color:var(--text-muted); font-size:0.8rem;">R$</span>
            <input type="number" step="0.01" min="0.01" class="quick-offer-price-input" value="${currentPromo.toFixed(2)}">
          </div>
        </td>
        <td>
          <span class="quick-offer-discount-badge" style="${discountPct > 0 ? '' : 'display:none;'}">
            -${discountPct}%
          </span>
        </td>
        <td>
          <input type="date" class="quick-offer-date-input" value="${item.promoExpiry || ''}">
        </td>
        <td style="text-align:center;">
          <button type="button" class="btn btn-sm btn-icon btn-danger remove-quick-offer-btn" title="Remover produto desta lista">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </td>
      `;

      // Event: Edit promo price
      const priceInput = tr.querySelector('.quick-offer-price-input');
      const badgeEl = tr.querySelector('.quick-offer-discount-badge');
      if (priceInput) {
        priceInput.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value) || 0;
          item.promoPrice = val;
          if (regularPrice > 0 && val > 0 && val < regularPrice) {
            const pct = Math.round(((regularPrice - val) / regularPrice) * 100);
            badgeEl.textContent = `-${pct}%`;
            badgeEl.style.display = 'inline-flex';
          } else {
            badgeEl.style.display = 'none';
          }
        });
      }

      // Event: Edit date
      const dateInput = tr.querySelector('.quick-offer-date-input');
      if (dateInput) {
        dateInput.addEventListener('change', (e) => {
          item.promoExpiry = e.target.value;
        });
      }

      // Event: Remove row
      const removeBtn = tr.querySelector('.remove-quick-offer-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          quickOfferItems.delete(id);
          updateQuickOfferTableUI();
          // If the search dropdown is open, restore the 'Adicionar' button on this item
          if (quickOfferSearchResults) {
            const searchItem = quickOfferSearchResults.querySelector(`.quick-offer-search-item[data-id="${id}"]`);
            if (searchItem) {
              searchItem.classList.remove('item-already-added');
              const actionArea = searchItem.querySelector('.quick-offer-item-action');
              if (actionArea) {
                actionArea.innerHTML = `<button type="button" class="btn btn-sm btn-primary" style="font-size:0.75rem; padding:3px 10px;"><i class="fa-solid fa-plus"></i> Adicionar</button>`;
              }
            }
          }
        });
      }

      quickOfferTableBody.appendChild(tr);
    });
  }

  function addProductToQuickOfferTable(product) {
    if (!product) return;
    const existing = quickOfferItems.get(product.id);
    if (existing) {
      // Highlight existing row
      const existingRow = quickOfferTableBody ? quickOfferTableBody.querySelector(`tr[data-id="${product.id}"]`) : null;
      if (existingRow) {
        existingRow.classList.add('quick-offer-row-highlight');
        existingRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => existingRow.classList.remove('quick-offer-row-highlight'), 1500);
      }
      return;
    }

    const defaultExpiry = quickOfferBatchDateInput ? quickOfferBatchDateInput.value : '';
    const currentIsPromo = productStore.isProductPromoActive(product);
    const regularPrice = parseFloat(product.unitPrice) || 0;

    let initialPromoPrice = 0;
    if (currentIsPromo && product.promoPrice > 0) {
      initialPromoPrice = parseFloat(product.promoPrice);
    } else if (regularPrice > 0) {
      initialPromoPrice = Number((regularPrice * 0.85).toFixed(2));
    }

    const expiry = (currentIsPromo && product.promoExpiry) ? product.promoExpiry : defaultExpiry;

    quickOfferItems.set(product.id, {
      product: product,
      promoPrice: initialPromoPrice,
      promoExpiry: expiry
    });

    updateQuickOfferTableUI();

    // Highlight the newly added row
    setTimeout(() => {
      const newRow = quickOfferTableBody ? quickOfferTableBody.querySelector(`tr[data-id="${product.id}"]`) : null;
      if (newRow) {
        newRow.classList.add('quick-offer-row-highlight');
        newRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => newRow.classList.remove('quick-offer-row-highlight'), 1500);
      }
    }, 50);
  }

  // Autocomplete Search Handler
  if (quickOfferSearchInput && quickOfferSearchResults) {
    let searchTimer = null;

    function closeQuickOfferSearch() {
      quickOfferSearchResults.style.display = 'none';
      if (quickOfferSearchClearBtn) quickOfferSearchClearBtn.style.display = 'none';
      quickOfferSearchInput.value = '';
    }

    if (quickOfferSearchClearBtn) {
      quickOfferSearchClearBtn.addEventListener('click', () => {
        closeQuickOfferSearch();
        quickOfferSearchInput.focus();
      });
    }

    quickOfferSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (searchTimer) clearTimeout(searchTimer);

      if (!q || q.length < 1) {
        quickOfferSearchResults.style.display = 'none';
        quickOfferSearchResults.innerHTML = '';
        if (quickOfferSearchClearBtn) quickOfferSearchClearBtn.style.display = 'none';
        return;
      }

      if (quickOfferSearchClearBtn) quickOfferSearchClearBtn.style.display = 'inline-flex';

      searchTimer = setTimeout(() => {
        const all = productStore.getProducts();
        const matches = all.filter(p => {
          const desc = String(p.description || '').toLowerCase();
          const code = String(p.code || '').toLowerCase();
          return desc.includes(q) || code.includes(q);
        }).slice(0, 20);

        if (matches.length === 0) {
          quickOfferSearchResults.innerHTML = `
            <div style="padding:14px; color:var(--text-muted); text-align:center; font-size:0.85rem;">
              <i class="fa-solid fa-circle-exclamation" style="margin-right:6px;"></i> Nenhum produto encontrado com "<strong>${q}</strong>".
            </div>
          `;
          quickOfferSearchResults.style.display = 'block';
          return;
        }

        quickOfferSearchResults.innerHTML = '';
        matches.forEach(p => {
          const itemDiv = document.createElement('div');
          itemDiv.className = 'quick-offer-search-item';
          itemDiv.dataset.id = p.id;
          const isAdded = quickOfferItems.has(p.id);
          if (isAdded) itemDiv.classList.add('item-already-added');

          itemDiv.innerHTML = `
            <div class="quick-offer-item-info">
              <div>
                <span class="quick-offer-item-desc">${p.description}</span>
                <span class="quick-offer-item-sku">SKU: ${p.code || 'S/N'} • Preço Normal: ${formatCurrency(p.unitPrice)}</span>
              </div>
            </div>
            <div class="quick-offer-item-action">
              ${isAdded ? 
                `<span class="badge" style="font-size:0.72rem; background:rgba(16,185,129,0.18); color:#10b981; border:1px solid rgba(16,185,129,0.35); font-weight:600;"><i class="fa-solid fa-check"></i> Na Tabela</span>` : 
                `<button type="button" class="btn btn-sm btn-primary" style="font-size:0.75rem; padding:3px 10px;"><i class="fa-solid fa-plus"></i> Adicionar</button>`
              }
            </div>
          `;

          // Clicking adds the item to the table WITHOUT closing the search dropdown!
          itemDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!quickOfferItems.has(p.id)) {
              addProductToQuickOfferTable(p);
              itemDiv.classList.add('item-already-added');
              const actionArea = itemDiv.querySelector('.quick-offer-item-action');
              if (actionArea) {
                actionArea.innerHTML = `
                  <span class="badge" style="font-size:0.72rem; background:rgba(16,185,129,0.18); color:#10b981; border:1px solid rgba(16,185,129,0.35); font-weight:600;">
                    <i class="fa-solid fa-check"></i> Na Tabela
                  </span>
                `;
              }
            } else {
              // Highlight row in table if already in
              addProductToQuickOfferTable(p);
            }
            // Keep input focused so user can continue interacting or press Esc
            quickOfferSearchInput.focus();
          });

          quickOfferSearchResults.appendChild(itemDiv);
        });

        quickOfferSearchResults.style.display = 'block';
      }, 100);
    });

    // Reopen dropdown on input focus if there is query
    quickOfferSearchInput.addEventListener('focus', () => {
      if (quickOfferSearchInput.value.trim().length > 0 && quickOfferSearchResults.children.length > 0) {
        quickOfferSearchResults.style.display = 'block';
      }
    });

    // Close search dropdown on click outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.quick-offer-search-container')) {
        quickOfferSearchResults.style.display = 'none';
      }
    });

    // Keydown handler: Escape exits search, Enter adds first unadded match
    quickOfferSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        closeQuickOfferSearch();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const unaddedItem = quickOfferSearchResults.querySelector('.quick-offer-search-item:not(.item-already-added)');
        if (unaddedItem) {
          unaddedItem.click();
        } else {
          const firstItem = quickOfferSearchResults.querySelector('.quick-offer-search-item');
          if (firstItem) firstItem.click();
        }
      }
    });

    // Global Esc listener when search dropdown is open
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (quickOfferSearchResults && quickOfferSearchResults.style.display !== 'none') {
          closeQuickOfferSearch();
        }
      }
    });
  }

  // Preset Date Buttons
  document.querySelectorAll('.quick-offer-preset-date').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.getAttribute('data-days') || 7);
      const d = new Date();
      d.setDate(d.getDate() + days);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      if (quickOfferBatchDateInput) quickOfferBatchDateInput.value = dateStr;
    });
  });

  // Apply Date to All Rows
  if (quickOfferApplyDateToAllBtn) {
    quickOfferApplyDateToAllBtn.addEventListener('click', () => {
      const dateVal = quickOfferBatchDateInput ? quickOfferBatchDateInput.value : '';
      if (!dateVal) {
        showToast('Selecione uma data no campo de prazo antes de aplicar.', 'error');
        return;
      }
      quickOfferItems.forEach(item => {
        item.promoExpiry = dateVal;
      });
      updateQuickOfferTableUI();
      showToast(`Data ${formatDateBR(dateVal)} aplicada em todas as ${quickOfferItems.size} linhas!`);
    });
  }

  // Load Currently Active Promo Products
  if (quickOfferLoadActiveBtn) {
    quickOfferLoadActiveBtn.addEventListener('click', () => {
      const promos = productStore.getProducts().filter(p => productStore.isProductPromoActive(p));
      if (promos.length === 0) {
        showToast('Não há nenhum produto em oferta ativa no catálogo no momento.');
        return;
      }
      promos.forEach(p => addProductToQuickOfferTable(p));
      showToast(`${promos.length} ${promos.length === 1 ? 'oferta ativa carregada' : 'ofertas ativas carregadas'} na tabela!`);
    });
  }

  // Clear Table
  if (quickOfferClearTableBtn) {
    quickOfferClearTableBtn.addEventListener('click', () => {
      if (confirm('Deseja limpar todos os produtos desta tabela de criação de ofertas?')) {
        quickOfferItems.clear();
        updateQuickOfferTableUI();
      }
    });
  }

  // Open Quick Offer Modal Button
  if (quickOfferTableBtn) {
    quickOfferTableBtn.addEventListener('click', () => {
      // Set default batch date to +7 days if empty
      if (quickOfferBatchDateInput && !quickOfferBatchDateInput.value) {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        quickOfferBatchDateInput.value = `${yyyy}-${mm}-${dd}`;
      }
      updateQuickOfferTableUI();
      openModal('quickOfferModal');
      setTimeout(() => {
        if (quickOfferSearchInput) quickOfferSearchInput.focus();
      }, 150);
    });
  }

  // Publish Quick Offers Button
  if (publishQuickOffersBtn) {
    publishQuickOffersBtn.addEventListener('click', () => {
      if (quickOfferItems.size === 0) {
        showToast('Adicione pelo menos um produto na tabela antes de publicar.', 'error');
        return;
      }

      productStore.recordState(); // Save single undo snapshot for the whole batch
      let validCount = 0;
      quickOfferItems.forEach((item, id) => {
        const price = parseFloat(item.promoPrice) || 0;
        const expiry = item.promoExpiry || '';
        if (price > 0) {
          const p = productStore.products.find(prod => prod.id === id);
          if (p) {
            p.promoActive = true;
            p.promoPrice = price;
            p.promoExpiry = expiry;
            validCount++;
          }
        }
      });
      productStore.ensurePositions();
      productStore.saveToStorage(false);

      closeModal('quickOfferModal');
      currentCategory = 'ofertas';
      currentPage = 1;
      syncPriceModeUI();
      renderCategoryPills();
      renderProducts();
      updateUndoRedoUI();
      showToast(`Sucesso! ${validCount} ${validCount === 1 ? 'produto publicado em oferta' : 'produtos publicados em oferta'} com destaque!`);
    });
  }

  // 8. Toolbar Buttons
  const togglePricesBtn = document.getElementById('togglePricesBtn');
  if (togglePricesBtn) {
    togglePricesBtn.addEventListener('click', () => {
      const current = productStore.getHidePrices();
      productStore.setHidePrices(!current);
      showToast(
        !current
          ? 'Preços OCULTOS para os clientes (Gestor continua vendo tudo).'
          : 'Preços VISÍVEIS para os clientes.',
        !current ? 'warning' : 'success'
      );
    });
  }

  const newProductBtn = document.getElementById('newProductBtn');
  if (newProductBtn) {
    newProductBtn.addEventListener('click', () => openEditProductModal(null));
  }

  const shareLinkBtn = document.getElementById('shareLinkBtn');
  const headerClientLinkBtn = document.getElementById('headerClientLinkBtn');

  // Removed autoCategorizeBtn logic as requested

  function openShareLinkModal() {
    const input = document.getElementById('clientLinkInput');
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const publicUrl = isLocal 
      ? 'https://fabioeufrazio.github.io/catalogo-dec-bebidas/?view=public' 
      : `${window.location.origin}${window.location.pathname}?view=public`;
    if (input) input.value = publicUrl;
    openModal('clientLinkModal');
  }

  if (shareLinkBtn) shareLinkBtn.addEventListener('click', openShareLinkModal);
  if (headerClientLinkBtn) headerClientLinkBtn.addEventListener('click', openShareLinkModal);

  const publishCloudBtn = document.getElementById('publishCloudBtn');
  if (publishCloudBtn) {
    publishCloudBtn.addEventListener('click', async () => {
      const confirmPublish = window.confirm(
        "⚠️ ATENÇÃO: PUBLICAR EM PRODUÇÃO\n\n" +
        "Você está prestes a enviar as alterações do seu ambiente de teste local diretamente para o catálogo ONLINE oficial dos clientes.\n\n" +
        "Deseja realmente atualizar o catálogo online agora?"
      );
      if (!confirmPublish) return;

      try {
        publishCloudBtn.disabled = true;
        publishCloudBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Publicando na Nuvem...';
        const count = await realtimeEngine.forcePublishToCloud();
        showToast(`Catálogo publicado com sucesso! ${count} produtos sincronizados na nuvem.`);
      } catch (err) {
        showToast('Erro ao publicar na nuvem: ' + err.message, 'error');
      } finally {
        publishCloudBtn.disabled = false;
        publishCloudBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Publicar Online';
      }
    });
  }

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

  // Undo / Redo Buttons & Dynamic UI state
  function updateUndoRedoUI() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn) {
      const can = productStore.canUndo();
      undoBtn.disabled = !can;
      undoBtn.style.opacity = can ? '1' : '0.35';
      undoBtn.style.cursor = can ? 'pointer' : 'not-allowed';
      undoBtn.title = can ? 'Desfazer última ação (Ctrl+Z)' : 'Nada para desfazer';
    }
    if (redoBtn) {
      const can = productStore.canRedo();
      redoBtn.disabled = !can;
      redoBtn.style.opacity = can ? '1' : '0.35';
      redoBtn.style.cursor = can ? 'pointer' : 'not-allowed';
      redoBtn.title = can ? 'Refazer ação (Ctrl+Y)' : 'Nada para refazer';
    }
  }

  const undoBtn = document.getElementById('undoBtn');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      if (productStore.undo()) {
        showToast('Ação desfeita (Undo).');
      } else {
        showToast('Nada para desfazer no momento.', 'info');
      }
      updateUndoRedoUI();
    });
  }

  const redoBtn = document.getElementById('redoBtn');
  if (redoBtn) {
    redoBtn.addEventListener('click', () => {
      if (productStore.redo()) {
        showToast('Ação refeita (Redo).');
      } else {
        showToast('Nada para refazer no momento.', 'info');
      }
      updateUndoRedoUI();
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
      if (fbProjectIdInput) {
        fbProjectIdInput.value = (cfg.projectId === 'catalogo-dec-bebidas' || cfg.projectId === 'catalogo-de-bebidas-1') 
          ? 'catalogo-online-dec' 
          : (cfg.projectId || 'catalogo-online-dec');
      }
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
          fbWarningAlert.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Por favor, informe o Project ID (ex: <code>catalogo-online-dec</code>).';
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

  // ==========================================================================
  // GESTOR AUTHENTICATION & SECRET ACCESS TRIGGERS
  // ==========================================================================
  const MASTER_PASSWORDS = ['dec2026', 'admin123', 'gestor2026'];

  // GATILHO OCULTO 1: Botão Secreto no Rodapé
  const hiddenGestorBtn = document.getElementById('hiddenGestorBtn');
  if (hiddenGestorBtn) {
    hiddenGestorBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!isManagerAuthenticated()) {
        openModal('adminLoginModal');
      } else {
        showToast('Você já está autenticado como Gestor.');
      }
    });
  }

  // GATILHO OCULTO 2: 3 cliques rápidos no logo da garrafa de bebida
  let logoClickCount = 0;
  let logoClickTimer = null;
  const brandLogo = document.querySelector('.brand-logo');
  if (brandLogo) {
    brandLogo.style.cursor = 'pointer';
    brandLogo.addEventListener('click', () => {
      if (isManagerAuthenticated()) return;
      logoClickCount++;
      if (logoClickTimer) clearTimeout(logoClickTimer);
      if (logoClickCount >= 3) {
        logoClickCount = 0;
        openModal('adminLoginModal');
      } else {
        logoClickTimer = setTimeout(() => {
          logoClickCount = 0;
        }, 900);
      }
    });
  }

  // GATILHO OCULTO 3: Atalho de Teclado Secreto (Ctrl + Shift + G)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      if (!isManagerAuthenticated()) {
        openModal('adminLoginModal');
      } else {
        showToast('Você já está em modo Gestor.');
      }
    }
  });

  // Formulário de Login Restrito do Gestor
  const adminLoginForm = document.getElementById('adminLoginForm');
  if (adminLoginForm) {
    adminLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailOrUser = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      const errorMsgEl = document.getElementById('loginErrorMessage');

      if (errorMsgEl) errorMsgEl.style.display = 'none';

      // 1. Verificação de Credenciais Mestras Autorizadas
      const savedCustomPass = localStorage.getItem('catalog_custom_master_pass');
      const isMasterValid = (savedCustomPass && password === savedCustomPass) || 
                            (!savedCustomPass && MASTER_PASSWORDS.includes(password));

      if (isMasterValid || (emailOrUser.toLowerCase() === 'admin' && (password === 'admin' || isMasterValid))) {
        localStorage.setItem('catalog_gestor_logged', 'true');
        localStorage.setItem('catalog_gestor_user', emailOrUser || 'Gestor');
        checkMode();
        syncPriceModeUI();
        renderCategoryPills();
        renderProducts();
        showToast('Acesso de Gestor concedido com sucesso!');
        closeModal('adminLoginModal');
        return;
      }

      // 2. Verificação via Firebase Auth Exclusivo
      try {
        if (emailOrUser.includes('@')) {
          await realtimeEngine.login(emailOrUser, password);
          localStorage.setItem('catalog_gestor_logged', 'true');
          localStorage.setItem('catalog_gestor_user', emailOrUser);
          checkMode();
          syncPriceModeUI();
          renderCategoryPills();
          renderProducts();
          showToast(`Bem-vindo, ${emailOrUser}! Login efetuado com sucesso.`);
          closeModal('adminLoginModal');
        } else {
          throw new Error('Credenciais inválidas. Acesso restrito exclusivamente ao gestor.');
        }
      } catch (err) {
        if (errorMsgEl) {
          errorMsgEl.textContent = err.message || 'Credenciais inválidas. Acesso negado.';
          errorMsgEl.style.display = 'block';
        }
      }
    });
  }

  // Esqueci Minha Senha (Redefinição Firebase)
  const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
  if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener('click', async () => {
      const email = document.getElementById('loginEmail').value.trim();
      const errorMsgEl = document.getElementById('loginErrorMessage');
      if (!email || !email.includes('@')) {
        if (errorMsgEl) {
          errorMsgEl.textContent = "Digite o seu e-mail cadastrado no campo acima e clique em 'Esqueci minha senha'.";
          errorMsgEl.style.display = 'block';
        }
        return;
      }
      try {
        await realtimeEngine.sendPasswordReset(email);
        alert(`Um e-mail de redefinição de senha foi enviado para "${email}". Verifique sua caixa de entrada e spam.`);
      } catch (err) {
        if (errorMsgEl) {
          errorMsgEl.textContent = err.message;
          errorMsgEl.style.display = 'block';
        }
      }
    });
  }

  // Logout do Gestor (Bloqueia o catálogo em modo cliente)
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      localStorage.removeItem('catalog_gestor_logged');
      localStorage.removeItem('catalog_gestor_user');
      try {
        await realtimeEngine.logout();
      } catch (e) {}
      checkMode();
      syncPriceModeUI();
      renderCategoryPills();
      renderProducts();
      showToast('Você saiu do modo Gestor. Catálogo travado em modo cliente.');
    });
  }

  // Listener de Estado do Firebase Auth
  realtimeEngine.onAuthStateChanged((user) => {
    const logoutBtnEl = document.getElementById('logoutBtn');
    if (user) {
      localStorage.setItem('catalog_gestor_logged', 'true');
      if (logoutBtnEl) {
        logoutBtnEl.style.display = 'inline-flex';
        logoutBtnEl.title = `Sair (${user.email})`;
      }
      closeModal('adminLoginModal');
    } else {
      if (!isManagerAuthenticated()) {
        if (logoutBtnEl) logoutBtnEl.style.display = 'none';
      }
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
      if (productStore.undo()) {
        showToast('Desfeito (Ctrl+Z).');
      } else {
        showToast('Nada para desfazer no momento.', 'info');
      }
      updateUndoRedoUI();
    }

    // Ctrl+Y or Cmd+Shift+Z (Redo)
    if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
      if (!isTyping) {
        e.preventDefault();
        if (productStore.redo()) {
          showToast('Refeito (Ctrl+Y).');
        } else {
          showToast('Nada para refazer no momento.', 'info');
        }
        updateUndoRedoUI();
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

  // 11. Subscribe Store Listener to Re-render UI (Batched via requestAnimationFrame)
  let renderRafId = null;
  function scheduleUIRender() {
    if (renderRafId) cancelAnimationFrame(renderRafId);
    renderRafId = requestAnimationFrame(() => {
      syncPriceModeUI();
      renderCategoryPills();
      renderProducts();
      updateUndoRedoUI();
    });
  }

  productStore.subscribe(() => {
    scheduleUIRender();
  });

  // 12. Initial Kickoff
  setupLaminaViewerEvents();
  setupAddLaminaModalEvents();
  checkMode();
  syncPriceModeUI();
  renderCategoryPills();
  renderProducts();
  updateUndoRedoUI();
});
