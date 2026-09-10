/* ==========================================================================
   ProductStore & HistoryStore
   State Management with Invariant POS Reindexing and Undo/Redo Engine
   ========================================================================== */

const STORAGE_KEYS = {
  PRODUCTS: 'catalog_products_v1',
  HIDE_PRICES: 'catalog_hide_prices',
  FIREBASE_CONFIG: 'catalog_firebase_config',
  LAMINAS: 'catalog_laminas_v1',
  CATEGORIES: 'catalog_categories_v1'
};

const DEFAULT_CATEGORIES = [
  { id: 'all', label: 'Todos', icon: 'fa-layer-group', system: true },
  { id: 'ofertas', label: 'Ofertas', icon: 'fa-fire', isPromo: true, system: true },
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
  { id: 'outros', label: 'Outros', icon: 'fa-boxes-stacked', isDefaultFallback: true }
];

const DEFAULT_LAMINAS = [
  {
    id: "LAM_DIAGEO_01",
    title: "Ofertas Exclusivas Diageo",
    imageUrl: "assets/laminas/diageo-ofertas.jpg",
    validity: "01/09/2026 a 12/09/2026",
    description: "",
    active: true,
    createdAt: "2026-09-01T00:00:00.000Z"
  },
  {
    id: "LAM_BALY_02",
    title: "Encarte Promocional Baly",
    imageUrl: "assets/laminas/baly-ofertas.jpg",
    validity: "01/09/2026 a 12/09/2026",
    description: "",
    active: true,
    createdAt: "2026-09-01T00:00:00.000Z"
  }
];

class HistoryStore {
  constructor(maxSize = 40) {
    this.maxSize = maxSize;
    this.undoStack = [];
    this.redoStack = [];
  }

  // Push the PREVIOUS valid state BEFORE a mutation happens
  pushState(products, hidePrices) {
    if (!products) return;
    const snapshot = {
      products: JSON.parse(JSON.stringify(products)),
      hidePrices: Boolean(hidePrices)
    };
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Any new user action invalidates redo history
  }

  pushSnapshot(products, hidePrices) {
    this.pushState(products, hidePrices);
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo(currentState) {
    if (!this.canUndo()) return null;
    const previousState = this.undoStack.pop();
    if (currentState) {
      this.redoStack.push({
        products: JSON.parse(JSON.stringify(currentState.products || [])),
        hidePrices: Boolean(currentState.hidePrices)
      });
    }
    return previousState;
  }

  redo(currentState) {
    if (!this.canRedo()) return null;
    const nextState = this.redoStack.pop();
    if (currentState) {
      this.redoStack.push({
        products: JSON.parse(JSON.stringify(currentState.products || [])),
        hidePrices: Boolean(currentState.hidePrices)
      });
    }
    return nextState;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

const historyStore = new HistoryStore(40);

class ProductStore {
  constructor() {
    this.products = [];
    this.laminas = [];
    this.categories = [];
    this.hidePrices = false;
    this.listeners = new Set();
    this.init();
  }

  init() {
    // Load Hide Prices
    const savedHide = localStorage.getItem(STORAGE_KEYS.HIDE_PRICES);
    this.hidePrices = savedHide === 'true';

    // Load Laminas de Ofertas
    this.loadLaminas();

    // Load Categories
    this.loadCategories();

    // Load Products
    const urlParams = new URLSearchParams(window.location.search);
    const isClient = urlParams.get('view') === 'public' || urlParams.get('client') === '1';

    const savedProducts = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
    if (savedProducts) {
      try {
        this.products = JSON.parse(savedProducts);
        this.products.forEach(p => {
          p.promoActive = false;
          p.promoPrice = 0;
          p.promoExpiry = '';
        });
      } catch (e) {
        console.error("Error parsing saved products:", e);
        this.products = [];
      }
    } else {
      // Only load sample products in gestor mode if empty
      if (!isClient && typeof INITIAL_SAMPLE_PRODUCTS !== 'undefined') {
        this.products = JSON.parse(JSON.stringify(INITIAL_SAMPLE_PRODUCTS));
      }
    }

    // Sort by position once on initial load
    this.products.sort((a, b) => (a.manualPosition || 9999) - (b.manualPosition || 9999));
    this.ensurePositions();
    this.saveToStorage(false); // don't push initial state to undo stack
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(source = 'local') {
    this.listeners.forEach(fn => fn(this.products, this.hidePrices, source));
  }

  recordState() {
    historyStore.pushState(this.products, this.hidePrices);
  }

  canUndo() {
    return historyStore.canUndo();
  }

  canRedo() {
    return historyStore.canRedo();
  }

  saveToStorage(recordHistory = false) {
    if (recordHistory) {
      this.recordState();
    }
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(this.products));
    localStorage.setItem(STORAGE_KEYS.HIDE_PRICES, String(this.hidePrices));
    this.notify('local');
  }

  ensurePositions() {
    // Remove system config dummy documents if present
    this.products = this.products.filter(p => {
      const code = String(p.code || '').trim().toUpperCase();
      const desc = String(p.description || '').trim().toUpperCase();
      return code !== 'CFG' && desc !== 'SYSTEM CONFIG' && p.id !== 'System Config';
    });

    // Synchronize manualPosition property with array index sequence 1..N
    // Clear legacy product-level offer flags since offers are now officially handled via Laminas / Encartes
    this.products.forEach((p, idx) => {
      p.manualPosition = idx + 1;
      p.promoActive = false;
      p.promoPrice = 0;
      p.promoExpiry = '';
    });
  }

  autoCategorizeAll(excelEngineRef) {
    const engine = excelEngineRef || (typeof excelEngine !== 'undefined' ? excelEngine : null);
    if (!engine || typeof engine.detectCategory !== 'function') return 0;
    
    let willChange = false;
    this.products.forEach(p => {
      const newCat = engine.detectCategory(p.description);
      if (newCat && newCat !== p.category) willChange = true;
    });

    if (willChange) {
      this.recordState();
    }

    let count = 0;
    this.products.forEach(p => {
      const newCat = engine.detectCategory(p.description);
      if (newCat && newCat !== p.category) {
        p.category = newCat;
        count++;
      }
    });
    if (count > 0) {
      this.saveToStorage(false);
    }
    return count;
  }

  getProducts() {
    return [...this.products].sort((a, b) => (a.manualPosition || 999999) - (b.manualPosition || 999999));
  }

  getHidePrices() {
    return this.hidePrices;
  }

  setHidePrices(hide) {
    if (this.hidePrices === hide) return;
    this.recordState();
    this.hidePrices = hide;
    this.saveToStorage(false);
  }

  addProduct(productData) {
    this.recordState();

    const newProduct = {
      id: `PROD_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      code: String(productData.code || '').trim(),
      description: String(productData.description || '').trim().toUpperCase(),
      unitPrice: parseFloat(productData.unitPrice) || 0,
      qtyPerBox: parseInt(productData.qtyPerBox) || 1,
      showBoxTotal: productData.showBoxTotal !== false,
      category: String(productData.category || 'outros').toLowerCase(),
      active: productData.active !== false,
      promoActive: false,
      promoPrice: 0,
      promoExpiry: '',
      manualPosition: this.products.length + 1,
      imageBase64: productData.imageBase64 || ''
    };

    this.products.push(newProduct);
    this.ensurePositions();
    this.saveToStorage(false);
    return newProduct;
  }

  isProductPromoActive(product) {
    return false;
  }

  setProductPromo(id, promoData) {
    if (!promoData || !promoData.active) {
      return this.updateProduct(id, {
        promoActive: false,
        promoPrice: 0,
        promoExpiry: ''
      });
    }

    return this.updateProduct(id, {
      promoActive: true,
      promoPrice: parseFloat(promoData.price) || 0,
      promoExpiry: promoData.expiry || ''
    });
  }

  updateProduct(id, updatedData) {
    const index = this.products.findIndex(p => p.id === id);
    if (index === -1) return false;

    this.recordState();

    const existing = this.products[index];
    this.products[index] = {
      ...existing,
      ...updatedData,
      code: updatedData.code !== undefined ? String(updatedData.code).trim() : existing.code,
      description: updatedData.description !== undefined ? String(updatedData.description).trim().toUpperCase() : existing.description,
      unitPrice: updatedData.unitPrice !== undefined ? parseFloat(updatedData.unitPrice) : existing.unitPrice,
      qtyPerBox: updatedData.qtyPerBox !== undefined ? parseInt(updatedData.qtyPerBox) : existing.qtyPerBox,
      category: updatedData.category !== undefined ? String(updatedData.category).toLowerCase() : existing.category,
      imageBase64: updatedData.imageBase64 !== undefined ? String(updatedData.imageBase64) : (existing.imageBase64 || ''),
      promoActive: updatedData.promoActive !== undefined ? !!updatedData.promoActive : existing.promoActive,
      promoPrice: updatedData.promoPrice !== undefined ? parseFloat(updatedData.promoPrice) : existing.promoPrice,
      promoExpiry: updatedData.promoExpiry !== undefined ? updatedData.promoExpiry : existing.promoExpiry
    };

    this.ensurePositions();
    this.saveToStorage(false);
    return true;
  }

  deleteProduct(id) {
    const exists = this.products.some(p => p.id === id);
    if (!exists) return false;

    this.recordState();
    this.products = this.products.filter(p => p.id !== id);
    this.ensurePositions();
    this.saveToStorage(false);
    return true;
  }

  duplicateProduct(id) {
    const existing = this.products.find(p => p.id === id);
    if (!existing) return null;

    this.recordState();

    const copy = {
      ...JSON.parse(JSON.stringify(existing)),
      id: `PROD_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      description: `${existing.description} (CÓPIA)`,
      manualPosition: existing.manualPosition + 1
    };

    const targetIdx = this.products.findIndex(p => p.id === id);
    this.products.splice(targetIdx + 1, 0, copy);
    this.ensurePositions();
    this.saveToStorage(false);
    return copy;
  }

  reorderProduct(id, newPosition) {
    const currentIdx = this.products.findIndex(p => p.id === id);
    if (currentIdx === -1) return;

    let targetIdx = parseInt(newPosition) - 1;
    if (isNaN(targetIdx)) return;

    targetIdx = Math.max(0, Math.min(targetIdx, this.products.length - 1));
    if (currentIdx === targetIdx) return;

    this.recordState();

    const [movedItem] = this.products.splice(currentIdx, 1);
    this.products.splice(targetIdx, 0, movedItem);

    this.ensurePositions();
    this.saveToStorage(false);
  }

  bulkUpdatePrice(ids, unitPrice, qtyPerBox) {
    const hasMatch = this.products.some(p => ids.includes(p.id));
    if (!hasMatch) return;

    this.recordState();
    let changed = false;
    this.products.forEach(p => {
      if (ids.includes(p.id)) {
        if (unitPrice !== undefined && unitPrice !== null && !isNaN(unitPrice)) {
          p.unitPrice = parseFloat(unitPrice);
        }
        if (qtyPerBox !== undefined && qtyPerBox !== null && !isNaN(qtyPerBox) && qtyPerBox > 0) {
          p.qtyPerBox = parseInt(qtyPerBox);
        }
        changed = true;
      }
    });
    if (changed) {
      this.saveToStorage(false);
    }
  }

  bulkUpdateCategory(ids, category) {
    const hasMatch = this.products.some(p => ids.includes(p.id));
    if (!hasMatch) return;

    this.recordState();
    this.products.forEach(p => {
      if (ids.includes(p.id)) {
        p.category = String(category).toLowerCase();
      }
    });
    this.saveToStorage(false);
  }

  bulkDelete(ids) {
    if (!ids || ids.length === 0) return;
    const hasMatch = this.products.some(p => ids.includes(p.id));
    if (!hasMatch) return;

    this.recordState();
    this.products = this.products.filter(p => !ids.includes(p.id));
    this.ensurePositions();
    this.saveToStorage(false);
  }

  bulkSetPromo(ids, { type, value, expiry }) {
    const hasMatch = this.products.some(p => ids.includes(p.id));
    if (!hasMatch) return false;

    this.recordState();
    let changed = false;
    this.products.forEach(p => {
      if (ids.includes(p.id)) {
        let promoPrice = p.unitPrice;
        if (type === 'percent') {
          const discount = (p.unitPrice * value) / 100;
          promoPrice = Math.max(0.01, p.unitPrice - discount);
        } else if (type === 'discount_fixed') {
          promoPrice = Math.max(0.01, p.unitPrice - value);
        } else if (type === 'fixed_price') {
          promoPrice = Math.max(0.01, value);
        }

        if (promoPrice < p.unitPrice) {
          p.promoActive = true;
          p.promoPrice = parseFloat(promoPrice.toFixed(2));
          p.promoExpiry = String(expiry || '');
          changed = true;
        }
      }
    });

    if (changed) {
      this.saveToStorage(false);
    }
    return changed;
  }

  bulkRemovePromo(ids) {
    const hasMatch = this.products.some(p => ids.includes(p.id) && p.promoActive);
    if (!hasMatch) return false;

    this.recordState();
    this.products.forEach(p => {
      if (ids.includes(p.id) && p.promoActive) {
        p.promoActive = false;
      }
    });

    this.saveToStorage(false);
    return true;
  }

  setAllProducts(newProducts, recordHistory = true) {
    if (recordHistory) {
      this.recordState();
    }
    this.products = JSON.parse(JSON.stringify(newProducts));
    this.products.sort((a, b) => (a.manualPosition || 999999) - (b.manualPosition || 999999));
    this.ensurePositions();
    this.saveToStorage(false);
  }

  clearAll() {
    this.recordState();
    this.products = [];
    this.saveToStorage(false);
  }

  undo() {
    if (!this.canUndo()) return false;
    const previousState = historyStore.undo({
      products: this.products,
      hidePrices: this.hidePrices
    });
    if (previousState) {
      this.products = previousState.products;
      this.hidePrices = previousState.hidePrices;
      this.ensurePositions();
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(this.products));
      localStorage.setItem(STORAGE_KEYS.HIDE_PRICES, String(this.hidePrices));
      this.notify('undo');
      return true;
    }
    return false;
  }

  redo() {
    if (!this.canRedo()) return false;
    const nextState = historyStore.redo({
      products: this.products,
      hidePrices: this.hidePrices
    });
    if (nextState) {
      this.products = nextState.products;
      this.hidePrices = nextState.hidePrices;
      this.ensurePositions();
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(this.products));
      localStorage.setItem(STORAGE_KEYS.HIDE_PRICES, String(this.hidePrices));
      this.notify('redo');
      return true;
    }
    return false;
  }

  ensureLaminaPositions() {
    if (!Array.isArray(this.laminas)) this.laminas = [];
    this.laminas.forEach((l, idx) => {
      l.manualPosition = idx + 1;
    });
  }

  loadLaminas() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LAMINAS);
      if (raw) {
        this.laminas = JSON.parse(raw);
        if (Array.isArray(this.laminas)) {
          this.laminas.forEach(l => l.description = '');
        }
      } else {
        this.laminas = JSON.parse(JSON.stringify(DEFAULT_LAMINAS));
      }
    } catch (e) {
      this.laminas = JSON.parse(JSON.stringify(DEFAULT_LAMINAS));
    }
    this.ensureLaminaPositions();
    this.saveLaminas();
  }

  getLaminas() {
    if (!Array.isArray(this.laminas)) return [];
    return [...this.laminas].sort((a, b) => (a.manualPosition || 9999) - (b.manualPosition || 9999));
  }

  saveLaminas(source = 'laminas_updated') {
    try {
      localStorage.setItem(STORAGE_KEYS.LAMINAS, JSON.stringify(this.laminas));
    } catch (e) {
      console.warn("Erro ao salvar laminas:", e);
    }
    this.notify(source);
  }

  setAllLaminas(laminas, source = 'cloud') {
    if (!Array.isArray(laminas)) return;
    this.laminas = laminas;
    this.ensureLaminaPositions();
    try {
      localStorage.setItem(STORAGE_KEYS.LAMINAS, JSON.stringify(this.laminas));
    } catch (e) {
      console.warn("Erro ao salvar laminas recebidas:", e);
    }
    this.notify(source);
  }

  addLamina(lamina) {
    if (!this.laminas) this.laminas = [];
    this.laminas.push(lamina);
    this.ensureLaminaPositions();
    this.saveLaminas();
  }

  deleteLamina(id) {
    if (!this.laminas) return;
    this.laminas = this.laminas.filter(l => l.id !== id);
    this.ensureLaminaPositions();
    this.saveLaminas();
  }

  deleteAllLaminas() {
    this.laminas = [];
    this.saveLaminas();
  }

  reorderLamina(id, newPosition) {
    if (!Array.isArray(this.laminas)) return;
    const index = this.laminas.findIndex(l => l.id === id);
    if (index === -1) return;
    const targetIndex = Math.max(0, Math.min(this.laminas.length - 1, newPosition - 1));
    const [item] = this.laminas.splice(index, 1);
    this.laminas.splice(targetIndex, 0, item);
    this.ensureLaminaPositions();
    this.saveLaminas();
  }

  moveLamina(id, direction) {
    if (!Array.isArray(this.laminas)) return;
    const index = this.laminas.findIndex(l => l.id === id);
    if (index === -1) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= this.laminas.length) return;
    const temp = this.laminas[index];
    this.laminas[index] = this.laminas[targetIndex];
    this.laminas[targetIndex] = temp;
    this.ensureLaminaPositions();
    this.saveLaminas();
  }

  // ==========================================
  // Categories Management Methods
  // ==========================================
  loadCategories() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CATEGORIES);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.categories = parsed;
        } else {
          this.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
        }
      } else {
        this.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
      }
    } catch (e) {
      console.warn("Erro ao carregar categorias salvas:", e);
      this.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    }

    // Ensure system categories 'all' and 'ofertas' exist at the front
    const hasAll = this.categories.some(c => c.id === 'all');
    if (!hasAll) {
      this.categories.unshift({ id: 'all', label: 'Todos', icon: 'fa-layer-group', system: true });
    }
    const hasOfertas = this.categories.some(c => c.id === 'ofertas');
    if (!hasOfertas) {
      const allIdx = this.categories.findIndex(c => c.id === 'all');
      this.categories.splice(allIdx + 1, 0, { id: 'ofertas', label: 'Ofertas', icon: 'fa-fire', isPromo: true, system: true });
    }
    // Ensure 'outros' exists
    const hasOutros = this.categories.some(c => c.id === 'outros');
    if (!hasOutros) {
      this.categories.push({ id: 'outros', label: 'Outros', icon: 'fa-boxes-stacked', isDefaultFallback: true });
    }

    this.saveCategories(false);
  }

  getCategories() {
    if (!Array.isArray(this.categories) || this.categories.length === 0) {
      return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
    }
    return JSON.parse(JSON.stringify(this.categories));
  }

  saveCategories(notify = true, source = 'categories_updated') {
    try {
      localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(this.categories));
    } catch (e) {
      console.warn("Erro ao salvar categorias:", e);
    }
    if (notify) {
      this.notify(source);
    }
  }

  slugifyCategory(text) {
    if (!text) return 'cat_' + Date.now();
    return String(text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || ('cat_' + Date.now());
  }

  addCategory({ label, icon, id = null }) {
    if (!Array.isArray(this.categories)) this.categories = [];
    const trimmedLabel = String(label || '').trim();
    if (!trimmedLabel) throw new Error("O nome da categoria não pode ser vazio.");

    let catId = id ? this.slugifyCategory(id) : this.slugifyCategory(trimmedLabel);
    
    // Ensure uniqueness
    let uniqueId = catId;
    let counter = 2;
    while (this.categories.some(c => c.id === uniqueId)) {
      uniqueId = `${catId}_${counter}`;
      counter++;
    }

    const newCategory = {
      id: uniqueId,
      label: trimmedLabel,
      icon: (icon || 'fa-tag').trim()
    };

    // Insert before 'outros' if 'outros' exists at the end
    const outrosIdx = this.categories.findIndex(c => c.id === 'outros');
    if (outrosIdx !== -1) {
      this.categories.splice(outrosIdx, 0, newCategory);
    } else {
      this.categories.push(newCategory);
    }

    this.saveCategories(true, 'category_added');
    return newCategory;
  }

  updateCategory(id, { label, icon }) {
    if (!Array.isArray(this.categories)) return null;
    if (id === 'all' || id === 'ofertas') {
      throw new Error("Categorias de sistema não podem ser alteradas.");
    }
    const cat = this.categories.find(c => c.id === id);
    if (!cat) throw new Error("Categoria não encontrada.");

    if (label && String(label).trim()) {
      cat.label = String(label).trim();
    }
    if (icon && String(icon).trim()) {
      cat.icon = String(icon).trim();
    }

    this.saveCategories(true, 'category_updated');
    return cat;
  }

  deleteCategory(id, fallbackCategory = 'outros') {
    if (id === 'all' || id === 'ofertas' || id === 'outros') {
      throw new Error("Categorias do sistema e categoria padrão não podem ser excluídas.");
    }
    const initialLen = this.categories.length;
    this.categories = this.categories.filter(c => c.id !== id);
    if (this.categories.length === initialLen) return { success: false, migratedProductsCount: 0 };

    // Migrate any products that had this category to fallbackCategory
    let migratedProductsCount = 0;
    if (Array.isArray(this.products)) {
      this.products.forEach(p => {
        if (p.category === id) {
          p.category = fallbackCategory;
          migratedProductsCount++;
        }
      });
      if (migratedProductsCount > 0) {
        this.saveToStorage(true);
      }
    }

    this.saveCategories(true, 'category_deleted');
    return { success: true, migratedProductsCount };
  }

  moveCategory(id, direction) {
    if (!Array.isArray(this.categories)) return;
    if (id === 'all' || id === 'ofertas') return; // Cannot move system tabs

    const index = this.categories.findIndex(c => c.id === id);
    if (index === -1) return;

    // Minimum target index is 2 (so we never displace 'all' and 'ofertas')
    const targetIndex = index + direction;
    if (targetIndex < 2 || targetIndex >= this.categories.length) return;

    const temp = this.categories[index];
    this.categories[index] = this.categories[targetIndex];
    this.categories[targetIndex] = temp;

    this.saveCategories(true, 'categories_reordered');
  }

  setCategories(categories, source = 'cloud') {
    if (!Array.isArray(categories) || categories.length === 0) return;
    this.categories = categories;
    this.saveCategories(true, source);
  }
}

const productStore = new ProductStore();
