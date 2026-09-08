/* ==========================================================================
   RealtimeEngine
   Local 0ms Multi-Tab Synchronization (BroadcastChannel) & Firebase Cloud Sync
   ========================================================================== */

class RealtimeEngine {
  constructor(store) {
    this.store = store;
    this.channel = null;
    this.db = null;
    this.firebaseActive = false;
    this.isSyncingFromRemote = false;

    this.initLocalSync();
    this.initFirebaseSync();
  }

  initLocalSync() {
    // 1. BroadcastChannel API
    if ('BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel('catalog_realtime_sync');
        this.channel.onmessage = (event) => {
          if (this.isSyncingFromRemote) return;
          const { type, products, hidePrices } = event.data || {};
          if (type === 'SYNC_ALL' && Array.isArray(products)) {
            this.isSyncingFromRemote = true;
            this.store.hidePrices = !!hidePrices;
            this.store.products = products;
            this.store.ensurePositions();
            localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
            localStorage.setItem(STORAGE_KEYS.HIDE_PRICES, String(hidePrices));
            this.store.notify('broadcast');
            this.isSyncingFromRemote = false;
          }
        };
      } catch (e) {
        console.warn("BroadcastChannel initialization failed:", e);
      }
    }

    // 2. Storage event listener fallback
    window.addEventListener('storage', (e) => {
      if (this.isSyncingFromRemote) return;
      if (e.key === STORAGE_KEYS.PRODUCTS || e.key === STORAGE_KEYS.HIDE_PRICES) {
        this.isSyncingFromRemote = true;
        this.store.init();
        this.store.notify('storage_event');
        this.isSyncingFromRemote = false;
      }
    });

    // Subscribe to store changes to broadcast locally
    this.store.subscribe((products, hidePrices, source) => {
      if (source !== 'broadcast' && source !== 'cloud' && source !== 'storage_event') {
        if (this.channel) {
          this.channel.postMessage({
            type: 'SYNC_ALL',
            products,
            hidePrices
          });
        }
        if (this.firebaseActive) {
          this.syncToCloud(products, hidePrices);
        }
      }
    });
  }

  initFirebaseSync() {
    const rawConfig = localStorage.getItem(STORAGE_KEYS.FIREBASE_CONFIG);
    if (!rawConfig) return;

    try {
      const config = JSON.parse(rawConfig);
      if (!config.apiKey || !config.projectId) return;

      if (typeof firebase !== 'undefined' && firebase.initializeApp) {
        if (!firebase.apps.length) {
          firebase.initializeApp(config);
        }
        this.db = firebase.firestore();
        this.firebaseActive = true;
        this.setupCloudListeners();
        this.updateCloudBadgeUI(true);
      }
    } catch (err) {
      console.warn("Firebase initialization error:", err);
      this.updateCloudBadgeUI(false);
    }
  }

  setupCloudListeners() {
    if (!this.db) return;

    // Listen to Settings
    this.db.collection('settings').doc('__SETTINGS__').onSnapshot((doc) => {
      if (doc.exists && !this.isSyncingFromRemote) {
        const data = doc.data();
        if (data.hidePrices !== undefined && data.hidePrices !== this.store.hidePrices) {
          this.isSyncingFromRemote = true;
          this.store.setHidePrices(data.hidePrices);
          this.isSyncingFromRemote = false;
        }
      }
    }, err => console.warn("Firestore settings listen error:", err));

    // Listen to Products
    this.db.collection('products').onSnapshot((snapshot) => {
      if (this.isSyncingFromRemote || snapshot.metadata.hasPendingWrites) return;

      const remoteProducts = [];
      snapshot.forEach(doc => {
        if (doc.id !== '__SETTINGS__') {
          remoteProducts.push(doc.data());
        }
      });

      if (remoteProducts.length > 0) {
        this.isSyncingFromRemote = true;
        this.store.setAllProducts(remoteProducts, false);
        this.isSyncingFromRemote = false;
      }
    }, err => console.warn("Firestore products listen error:", err));
  }

  async syncToCloud(products, hidePrices) {
    if (!this.db || !this.firebaseActive) return;

    try {
      // Update Settings
      await this.db.collection('settings').doc('__SETTINGS__').set({
        hidePrices,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // Update Products in batches of 80
      const batchSize = 80;
      for (let i = 0; i < products.length; i += batchSize) {
        const batch = this.db.batch();
        const chunk = products.slice(i, i + batchSize);
        chunk.forEach(p => {
          const ref = this.db.collection('products').doc(p.id);
          batch.set(ref, p);
        });
        await batch.commit();
      }
    } catch (e) {
      console.error("Cloud sync error:", e);
    }
  }

  async login(email, password) {
    if (!typeof firebase !== 'undefined' || !firebase.auth) {
      throw new Error("Firebase Auth não está inicializado.");
    }
    return firebase.auth().signInWithEmailAndPassword(email, password);
  }

  async logout() {
    if (!typeof firebase !== 'undefined' || !firebase.auth) return;
    return firebase.auth().signOut();
  }

  onAuthStateChanged(callback) {
    if (typeof firebase !== 'undefined' && firebase.auth) {
      return firebase.auth().onAuthStateChanged(callback);
    }
    return () => {};
  }

  updateCloudBadgeUI(active) {
    const badge = document.getElementById('cloudStatusBadge');
    if (badge) {
      if (active) {
        badge.className = 'badge badge-active';
        badge.innerHTML = '<i class="fa-solid fa-cloud"></i> Nuvem: Conectado';
      } else {
        badge.className = 'badge badge-warning';
        badge.innerHTML = '<i class="fa-solid fa-cloud-slash"></i> Nuvem: Offline (Local)';
      }
    }
  }
}
