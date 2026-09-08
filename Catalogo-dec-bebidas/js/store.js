/* ==========================================================================
   ProductStore & HistoryStore
   State Management with Invariant POS Reindexing and Undo/Redo Engine
   ========================================================================== */

const STORAGE_KEYS = {
  PRODUCTS: 'catalog_products_v1',
  HIDE_PRICES: 'catalog_hide_prices',
  FIREBASE_CONFIG: 'catalog_firebase_config'
};

class HistoryStore {
  constructor(maxSize = 30) {
    this.maxSize = maxSize;
    this.undoStack = [];
    this.redoStack = [];
  }

  pushSnapshot(products, hidePrices) {
    const state = JSON.parse(JSON.stringify({ products, hidePrices }));
    this.undoStack.push(state);
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Clear redo stack on new action
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo(currentState) {
    if (!this.canUndo()) return null;
    this.redoStack.push(JSON.parse(JSON.stringify(currentState)));
    return this.undoStack.pop();
  }

  redo(currentState) {
    if (!this.canRedo()) return null;
    this.undoStack.push(JSON.parse(JSON.stringify(currentState)));
    return this.redoStack.pop();
  }
}

const historyStore = new HistoryStore(30);

class ProductStore {
  constructor() {
    this.products = [];
    this.hidePrices = false;
    this.listeners = new Set();
    this.init();
  }

  init() {
    // Load Hide Prices
    const savedHide = localStorage.getItem(STORAGE_KEYS.HIDE_PRICES);
    this.hidePrices = savedHide === 'true';

    // Load Products
    const savedProducts = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
    if (savedProducts) {
      try {
        this.products = JSON.parse(savedProducts);
      } catch (e) {
        console.error("Error parsing saved products:", e);
        this.products = [];
      }
    }

    if (!this.products || this.products.length === 0) {
      if (typeof INITIAL_SAMPLE_PRODUCTS !== 'undefined') {
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

  saveToStorage(recordHistory = true) {
    if (recordHistory) {
      historyStore.pushSnapshot(this.products, this.hidePrices);
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

    // Auto-categorize beverages automatically whenever products are loaded or modified
    if (typeof excelEngine !== 'undefined' && typeof excelEngine.detectCategory === 'function') {
      this.products.forEach(p => {
        if (!p.category || p.category === 'outros') {
          const detected = excelEngine.detectCategory(p.description);
          if (detected && detected !== 'outros') {
            p.category = detected;
          }
        }
      });
    }

    // Synchronize manualPosition property with array index sequence 1..N
    this.products.forEach((p, idx) => {
      p.manualPosition = idx + 1;
    });
  }

  autoCategorizeAll(excelEngineRef) {
    const engine = excelEngineRef || (typeof excelEngine !== 'undefined' ? excelEngine : null);
    if (!engine || typeof engine.detectCategory !== 'function') return 0;
    let count = 0;
    this.products.forEach(p => {
      const newCat = engine.detectCategory(p.description);
      if (newCat && newCat !== p.category) {
        p.category = newCat;
        count++;
      }
    });
    if (count > 0) {
      this.saveToStorage(true);
    }
    return count;
  }

  getProducts() {
    return [...this.products];
  }

  getHidePrices() {
    return this.hidePrices;
  }

  setHidePrices(hide) {
    if (this.hidePrices === hide) return;
    this.hidePrices = hide;
    this.saveToStorage(true);
  }

  addProduct(productData) {
    const newProduct = {
      id: `PROD_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      code: String(productData.code || '').trim(),
      description: String(productData.description || '').trim().toUpperCase(),
      unitPrice: parseFloat(productData.unitPrice) || 0,
      qtyPerBox: parseInt(productData.qtyPerBox) || 1,
      showBoxTotal: productData.showBoxTotal !== false,
      category: String(productData.category || 'outros').toLowerCase(),
      active: productData.active !== false,
      manualPosition: this.products.length + 1,
      imageBase64: productData.imageBase64 || ''
    };

    this.products.push(newProduct);
    this.ensurePositions();
    this.saveToStorage(true);
    return newProduct;
  }

  updateProduct(id, updatedData) {
    const index = this.products.findIndex(p => p.id === id);
    if (index === -1) return false;

    const existing = this.products[index];
    this.products[index] = {
      ...existing,
      ...updatedData,
      code: updatedData.code !== undefined ? String(updatedData.code).trim() : existing.code,
      description: updatedData.description !== undefined ? String(updatedData.description).trim().toUpperCase() : existing.description,
      unitPrice: updatedData.unitPrice !== undefined ? parseFloat(updatedData.unitPrice) : existing.unitPrice,
      qtyPerBox: updatedData.qtyPerBox !== undefined ? parseInt(updatedData.qtyPerBox) : existing.qtyPerBox,
      category: updatedData.category !== undefined ? String(updatedData.category).toLowerCase() : existing.category
    };

    this.ensurePositions();
    this.saveToStorage(true);
    return true;
  }

  deleteProduct(id) {
    const initialLen = this.products.length;
    this.products = this.products.filter(p => p.id !== id);
    if (this.products.length !== initialLen) {
      this.ensurePositions();
      this.saveToStorage(true);
      return true;
    }
    return false;
  }

  duplicateProduct(id) {
    const existing = this.products.find(p => p.id === id);
    if (!existing) return null;

    const copy = {
      ...JSON.parse(JSON.stringify(existing)),
      id: `PROD_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      description: `${existing.description} (CÓPIA)`,
      manualPosition: existing.manualPosition + 1
    };

    const targetIdx = this.products.findIndex(p => p.id === id);
    this.products.splice(targetIdx + 1, 0, copy);
    this.ensurePositions();
    this.saveToStorage(true);
    return copy;
  }

  reorderProduct(id, newPosition) {
    const currentIdx = this.products.findIndex(p => p.id === id);
    if (currentIdx === -1) return;

    let targetIdx = parseInt(newPosition) - 1;
    if (isNaN(targetIdx)) return;

    targetIdx = Math.max(0, Math.min(targetIdx, this.products.length - 1));
    if (currentIdx === targetIdx) return;

    const [movedItem] = this.products.splice(currentIdx, 1);
    this.products.splice(targetIdx, 0, movedItem);

    this.ensurePositions();
    this.saveToStorage(true);
  }

  bulkUpdatePrice(ids, unitPrice, qtyPerBox) {
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
      this.saveToStorage(true);
    }
  }

  bulkUpdateCategory(ids, category) {
    let changed = false;
    this.products.forEach(p => {
      if (ids.includes(p.id)) {
        p.category = String(category).toLowerCase();
        changed = true;
      }
    });
    if (changed) {
      this.saveToStorage(true);
    }
  }

  bulkDelete(ids) {
    this.products = this.products.filter(p => !ids.includes(p.id));
    this.ensurePositions();
    this.saveToStorage(true);
  }

  setAllProducts(newProducts, recordHistory = true) {
    this.products = JSON.parse(JSON.stringify(newProducts));
    this.ensurePositions();
    this.saveToStorage(recordHistory);
  }

  clearAll() {
    this.products = [];
    this.saveToStorage(true);
  }

  undo() {
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
}

const productStore = new ProductStore();
