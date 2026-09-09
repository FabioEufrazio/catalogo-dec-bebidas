/* ==========================================================================
   ProductStore & HistoryStore
   State Management with Invariant POS Reindexing and Undo/Redo Engine
   ========================================================================== */

const STORAGE_KEYS = {
  PRODUCTS: 'catalog_products_v1',
  HIDE_PRICES: 'catalog_hide_prices',
  FIREBASE_CONFIG: 'catalog_firebase_config',
  LAMINAS: 'catalog_laminas_v1'
};

const DEFAULT_LAMINAS = [
  {
    id: "LAM_DIAGEO_01",
    title: "Ofertas Exclusivas Diageo",
    imageUrl: "assets/laminas/diageo-ofertas.jpg",
    validity: "01/09/2026 a 12/09/2026",
    description: "Smirnoff Ice, Ypióca, Cîroc, Gordon's e Smirnoff Vodka",
    active: true,
    createdAt: "2026-09-01T00:00:00.000Z"
  },
  {
    id: "LAM_BALY_02",
    title: "Encarte Promocional Baly",
    imageUrl: "assets/laminas/baly-ofertas.jpg",
    validity: "01/09/2026 a 12/09/2026",
    description: "Baly Energy Drink 2L, 1L, Lata 473ml e 250ml",
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

  loadLaminas() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LAMINAS);
      if (raw) {
        this.laminas = JSON.parse(raw);
      } else {
        this.laminas = JSON.parse(JSON.stringify(DEFAULT_LAMINAS));
        this.saveLaminas();
      }
    } catch (e) {
      this.laminas = JSON.parse(JSON.stringify(DEFAULT_LAMINAS));
    }
  }

  getLaminas() {
    return Array.isArray(this.laminas) ? this.laminas : [];
  }

  saveLaminas() {
    try {
      localStorage.setItem(STORAGE_KEYS.LAMINAS, JSON.stringify(this.laminas));
    } catch (e) {
      console.warn("Erro ao salvar laminas:", e);
    }
    this.notify('laminas_updated');
  }

  addLamina(lamina) {
    if (!this.laminas) this.laminas = [];
    this.laminas.unshift(lamina);
    this.saveLaminas();
  }

  deleteLamina(id) {
    if (!this.laminas) return;
    this.laminas = this.laminas.filter(l => l.id !== id);
    this.saveLaminas();
  }
}

const productStore = new ProductStore();
