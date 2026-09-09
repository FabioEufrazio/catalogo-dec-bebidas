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

    const urlParams = new URLSearchParams(window.location.search);
    this.isClientView = urlParams.get('view') === 'public' || urlParams.get('client') === '1';

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
    const DEFAULT_CONFIG = {
      apiKey: "AIzaSyB2ArO22BUXnqIKc_Nelm3EapuQAiRRM80",
      projectId: "catalogo-online-dec",
      appId: "1:963138199795:web:da56b25b1da777193cd786",
      authDomain: "catalogo-online-dec.firebaseapp.com"
    };

    let rawConfig = localStorage.getItem(STORAGE_KEYS.FIREBASE_CONFIG);
    if (rawConfig) {
      try {
        const parsed = JSON.parse(rawConfig);
        // Auto-fix if user has catalogo-dec-bebidas which doesn't exist in Google Cloud
        if (parsed.projectId === 'catalogo-dec-bebidas' || parsed.projectId === 'catalogo-de-bebidas-1') {
          parsed.projectId = DEFAULT_CONFIG.projectId;
          parsed.apiKey = DEFAULT_CONFIG.apiKey;
          parsed.appId = DEFAULT_CONFIG.appId;
          parsed.authDomain = DEFAULT_CONFIG.authDomain;
          rawConfig = JSON.stringify(parsed);
          localStorage.setItem(STORAGE_KEYS.FIREBASE_CONFIG, rawConfig);
        }
      } catch (e) {
        rawConfig = null;
      }
    }

    if (!rawConfig) {
      rawConfig = JSON.stringify(DEFAULT_CONFIG);
      localStorage.setItem(STORAGE_KEYS.FIREBASE_CONFIG, rawConfig);
    }

    try {
      const config = JSON.parse(rawConfig);
      if (!config.apiKey || !config.projectId) return;

      const fullConfig = {
        apiKey: config.apiKey,
        authDomain: config.authDomain || `${config.projectId.toLowerCase()}.firebaseapp.com`,
        projectId: config.projectId,
        storageBucket: config.storageBucket || `${config.projectId.toLowerCase()}.appspot.com`,
        appId: config.appId || undefined
      };

      if (typeof firebase !== 'undefined' && firebase.initializeApp) {
        if (!firebase.apps.length) {
          firebase.initializeApp(fullConfig);
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

    // Optimized Single-Document Cloud Listener (Uses only 1 Read instead of 1,000 Reads)
    this.db.collection('catalogs').doc('active').onSnapshot({ includeMetadataChanges: true }, (doc) => {
      if (this.isSyncingFromRemote || !doc.exists || doc.metadata.hasPendingWrites) return;
      const data = doc.data();
      if (!data) return;

      this.isSyncingFromRemote = true;

      if (data.hidePrices !== undefined && data.hidePrices !== this.store.hidePrices) {
        this.store.setHidePrices(data.hidePrices);
      }

      if (Array.isArray(data.products)) {
        // Remote data exists: update local state if remote is different
        const localHash = JSON.stringify(this.store.products);
        const remoteHash = JSON.stringify(data.products);
        if (localHash !== remoteHash) {
          console.log(`Recebendo atualização da nuvem: ${data.products.length} produtos.`);
          this.store.setAllProducts(data.products, false);
        }
      } else if (!this.isClientView && (!data.products || data.products.length === 0) && this.store.products.length > 0) {
        // Only GESTOR auto-publishes local products to Firestore if cloud is empty
        console.log("Firestore cloud is empty. Auto-publishing local catalog to cloud...");
        this.syncToCloud(this.store.products, this.store.hidePrices);
      }

      this.isSyncingFromRemote = false;
    }, err => console.warn("Firestore catalog listen error:", err));
  }

  sanitizeProductForCloud(p) {
    return {
      id: String(p.id || ''),
      code: String(p.code || ''),
      description: String(p.description || ''),
      unitPrice: parseFloat(p.unitPrice) || 0,
      qtyPerBox: parseInt(p.qtyPerBox) || 1,
      showBoxTotal: p.showBoxTotal !== false,
      category: String(p.category || 'outros'),
      active: p.active !== false,
      manualPosition: parseInt(p.manualPosition) || 1,
      imageBase64: String(p.imageBase64 || ''),
      promoActive: !!p.promoActive,
      promoPrice: parseFloat(p.promoPrice) || 0,
      promoExpiry: String(p.promoExpiry || '')
    };
  }

  async writeViaRest(cleanProducts, hidePrices) {
    let projectId = 'catalogo-online-dec';
    try {
      const rawConfig = localStorage.getItem(STORAGE_KEYS.FIREBASE_CONFIG);
      if (rawConfig) {
        const parsed = JSON.parse(rawConfig);
        if (parsed.projectId && parsed.projectId !== 'catalogo-dec-bebidas' && parsed.projectId !== 'catalogo-de-bebidas-1') {
          projectId = parsed.projectId;
        }
      }
    } catch (e) {}

    const restPayload = {
      fields: {
        hidePrices: { booleanValue: !!hidePrices },
        products: {
          arrayValue: {
            values: cleanProducts.map(p => ({
              mapValue: {
                fields: {
                  id: { stringValue: String(p.id || '') },
                  code: { stringValue: String(p.code || '') },
                  description: { stringValue: String(p.description || '') },
                  unitPrice: { doubleValue: Number(p.unitPrice) || 0 },
                  qtyPerBox: { integerValue: String(p.qtyPerBox || 1) },
                  showBoxTotal: { booleanValue: p.showBoxTotal !== false },
                  category: { stringValue: String(p.category || 'outros') },
                  active: { booleanValue: p.active !== false },
                  manualPosition: { integerValue: String(p.manualPosition || 1) },
                  imageBase64: { stringValue: String(p.imageBase64 || '') },
                  promoActive: { booleanValue: !!p.promoActive },
                  promoPrice: { doubleValue: Number(p.promoPrice) || 0 },
                  promoExpiry: { stringValue: String(p.promoExpiry || '') }
                }
              }
            }))
          }
        }
      }
    };

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/catalogs/active`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(restPayload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Falha HTTP ${res.status}: ${errText}`);
    }
    return cleanProducts.length;
  }

  async forcePublishToCloud() {
    if (this.isClientView) {
      throw new Error("Modo cliente é apenas leitura.");
    }
    const cleanProducts = (this.store.products || []).map(p => this.sanitizeProductForCloud(p));
    const hidePrices = !!this.store.hidePrices;

    // Try SDK write with 3.5s timeout. If SDK hangs or fails, fall back to REST immediately!
    const sdkPromise = (async () => {
      if (!this.db || !this.firebaseActive) {
        throw new Error("SDK não ativo");
      }
      const payload = {
        hidePrices: hidePrices,
        products: cleanProducts,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await this.db.collection('catalogs').doc('active').set(payload);
      return cleanProducts.length;
    })();

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("TIMEOUT_SDK")), 3500)
    );

    try {
      return await Promise.race([sdkPromise, timeoutPromise]);
    } catch (err) {
      console.warn("SDK write falhou ou demorou. Usando fallback REST API imediato...", err);
      return await this.writeViaRest(cleanProducts, hidePrices);
    }
  }

  async syncToCloud(products, hidePrices) {
    if (this.isClientView) return; // Clientes em view=public são estritamente somente-leitura!

    // Debounce cloud sync by 400ms to avoid unnecessary network requests
    if (this.cloudSyncTimeout) clearTimeout(this.cloudSyncTimeout);

    this.cloudSyncTimeout = setTimeout(async () => {
      try {
        const cleanProducts = (products || []).map(p => this.sanitizeProductForCloud(p));
        const hide = !!hidePrices;

        const sdkPromise = (async () => {
          if (!this.db || !this.firebaseActive) throw new Error("SDK inativo");
          const payload = {
            hidePrices: hide,
            products: cleanProducts,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          };
          await this.db.collection('catalogs').doc('active').set(payload);
        })();

        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("TIMEOUT")), 3500)
        );

        try {
          await Promise.race([sdkPromise, timeoutPromise]);
          console.log("Firestore cloud sync (SDK) succeeded:", cleanProducts.length, "products synced.");
        } catch (e) {
          console.warn("Firestore sync SDK timeout/erro, enviando via REST...", e);
          await this.writeViaRest(cleanProducts, hide);
          console.log("Firestore cloud sync (REST) succeeded:", cleanProducts.length, "products synced.");
        }
      } catch (e) {
        console.error("Cloud sync error:", e);
      }
    }, 400);
  }

  async login(email, password) {
    if (typeof firebase === 'undefined' || !firebase.apps || firebase.apps.length === 0 || !firebase.auth) {
      throw new Error("Por favor, insira e salve suas credenciais do Firebase primeiro no botão 🔥 (Firebase) no topo.");
    }
    try {
      return await firebase.auth().signInWithEmailAndPassword(email, password);
    } catch (err) {
      throw this.translateAuthError(err);
    }
  }

  async signUp(email, password) {
    if (typeof firebase === 'undefined' || !firebase.apps || firebase.apps.length === 0 || !firebase.auth) {
      throw new Error("Por favor, insira e salve suas credenciais do Firebase primeiro no botão 🔥 (Firebase) no topo.");
    }
    try {
      return await firebase.auth().createUserWithEmailAndPassword(email, password);
    } catch (err) {
      throw this.translateAuthError(err);
    }
  }

  async sendPasswordReset(email) {
    if (typeof firebase === 'undefined' || !firebase.apps || firebase.apps.length === 0 || !firebase.auth) {
      throw new Error("Por favor, insira e salve suas credenciais do Firebase primeiro no botão 🔥 (Firebase) no topo.");
    }
    try {
      return await firebase.auth().sendPasswordResetEmail(email);
    } catch (err) {
      throw this.translateAuthError(err);
    }
  }

  translateAuthError(err) {
    const code = err ? (err.code || '') : '';
    const message = err ? (err.message || '') : '';
    console.warn("Firebase Auth Error:", code, message);

    switch (code) {
      case 'auth/user-not-found':
        return new Error("Nenhum usuário cadastrado com este e-mail. Clique no botão 'Criar Nova Conta' para registrar este gestor.");
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return new Error("Senha incorreta. Verifique se o Caps Lock está ligado ou clique em 'Esqueci minha senha'.");
      case 'auth/invalid-email':
        return new Error("O formato do e-mail digitado é inválido.");
      case 'auth/user-disabled':
        return new Error("Esta conta de gestor foi desativada no Firebase.");
      case 'auth/operation-not-allowed':
        return new Error("O login por E-mail/Senha não está ativado no Firebase Console. Vá em Authentication > Sign-in method e ative 'E-mail/Senha'.");
      case 'auth/email-already-in-use':
        return new Error("Este e-mail já está cadastrado no Firebase. Tente entrar com a sua senha ou clique em 'Esqueci minha senha'.");
      case 'auth/weak-password':
        return new Error("A senha escolhida é muito fraca. Digite pelo menos 6 caracteres.");
      case 'auth/invalid-api-key':
      case 'auth/api-key-not-valid-please-pass-a-valid-api-key':
        return new Error("A API Key do Firebase digitada no botão 🔥 é inválida. Cole a API Key correta do seu projeto.");
      default:
        return new Error(message || "Erro de conexão/autenticação no Firebase. Verifique seus dados ou use o Modo Local.");
    }
  }

  async logout() {
    if (typeof firebase === 'undefined' || !firebase.apps || firebase.apps.length === 0 || !firebase.auth) return;
    return firebase.auth().signOut();
  }

  onAuthStateChanged(callback) {
    if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0 && firebase.auth) {
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
