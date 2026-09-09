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
    this.isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

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
          const { type, products, hidePrices, laminas } = event.data || {};
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
          if (type === 'SYNC_LAMINAS' && Array.isArray(laminas)) {
            this.isSyncingFromRemote = true;
            this.store.setAllLaminas(laminas, 'broadcast');
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
      if (e.key === STORAGE_KEYS.LAMINAS) {
        this.isSyncingFromRemote = true;
        this.store.loadLaminas();
        this.store.notify('storage_event');
        this.isSyncingFromRemote = false;
      }
    });

    // Subscribe to store changes to broadcast locally
    this.store.subscribe((products, hidePrices, source) => {
      if (source === 'laminas_updated') {
        if (this.channel) {
          this.channel.postMessage({
            type: 'SYNC_LAMINAS',
            laminas: this.store.getLaminas()
          });
        }
        if (!this.isLocal && !this.isClientView && this.firebaseActive) {
          this.syncLaminasToCloud(this.store.getLaminas());
        }
        return;
      }

      if (source !== 'broadcast' && source !== 'cloud' && source !== 'storage_event') {
        if (this.channel) {
          this.channel.postMessage({
            type: 'SYNC_ALL',
            products,
            hidePrices
          });
        }
        // BLINDAGEM DE TESTES: NUNCA disparar auto-sync em segundo plano no ambiente local (localhost)!
        // No local, modificações ficam 100% isoladas. Só sobem para produção se o gestor clicar conscientemente em "Publicar Online".
        if (!this.isLocal && !this.isClientView && this.firebaseActive) {
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
        this.fetchInitialLaminasFromCloud();
        this.syncInitialGestorLaminasToCloud();
      } else {
        this.fetchInitialLaminasFromCloud();
      }
    } catch (err) {
      console.warn("Firebase initialization error:", err);
      this.updateCloudBadgeUI(false);
      this.fetchInitialLaminasFromCloud();
    }
  }

  async fetchInitialLaminasFromCloud() {
    const isGestor = localStorage.getItem('catalog_gestor_logged') === 'true';
    if (isGestor) return;

    try {
      if (this.db && this.firebaseActive) {
        const doc = await this.db.collection('catalogs').doc('laminas').get();
        if (doc.exists && doc.data() && Array.isArray(doc.data().laminas)) {
          this.applyRemoteLaminas(doc.data().laminas);
          return;
        }
      }
      const remoteLaminas = await this.readLaminasViaRest();
      if (remoteLaminas.length > 0) {
        this.applyRemoteLaminas(remoteLaminas);
      }
    } catch (e) {
      console.warn("Tentativa inicial de buscar encartes via nuvem:", e);
    }
  }

  async syncInitialGestorLaminasToCloud() {
    const isGestor = !this.isClientView && (localStorage.getItem('catalog_gestor_logged') === 'true');
    if (!isGestor || this.isLocal || !this.firebaseActive) return;

    try {
      const localLaminas = this.store.getLaminas();
      if (localLaminas && localLaminas.length > 0) {
        const cleanLaminas = localLaminas.map(l => this.sanitizeLaminaForCloud(l));
        if (this.db) {
          await this.writeLaminasViaSDK(cleanLaminas);
        } else {
          await this.writeLaminasViaRest(cleanLaminas);
        }
        console.log("Encartes do gestor sincronizados com a nuvem na inicialização:", cleanLaminas.length);
      }
    } catch (e) {
      console.warn("Auto-sync inicial de encartes do gestor:", e);
    }
  }

  getCatalogSignature(products) {
    if (!Array.isArray(products)) return '';
    return products.map(p => 
      `${p.id}:${p.code}:${p.description}:${p.unitPrice}:${p.qtyPerBox}:${p.showBoxTotal !== false}:${p.category}:${p.active !== false}:${p.manualPosition || 0}:${!!p.promoActive}:${p.promoPrice || 0}:${p.promoExpiry || ''}:${(p.imageBase64 || '').length}`
    ).join(';');
  }

  setupCloudListeners() {
    if (!this.db) return;

    // Escuta remota em tempo real com controle de metadados e suporte a múltiplos chunks
    this.db.collection('catalogs').doc('active').onSnapshot({ includeMetadataChanges: true }, async (doc) => {
      if (this.isSyncingFromRemote || !doc.exists) return;

      // 1. Ignora escritas locais que ainda estão sendo gravadas no Firestore
      if (doc.metadata && doc.metadata.hasPendingWrites) return;

      // 2. BLINDAGEM DO GESTOR: Se o usuário estiver no MODO GESTOR (autenticado),
      // a tela dele é a autoridade máxima de edição. NUNCA deixar um snapshot antigo da nuvem
      // sobrescrever o que o gestor acabou de colar (Ctrl+V) ou editar!
      const isGestor = localStorage.getItem('catalog_gestor_logged') === 'true';
      if (isGestor) {
        return;
      }

      const data = doc.data();
      if (!data) return;

      if (data.hidePrices !== undefined && data.hidePrices !== this.store.hidePrices) {
        this.store.setHidePrices(data.hidePrices);
      }

      const chunkCount = parseInt(data.chunkCount) || 1;
      let remoteProducts = [];

      if (chunkCount > 1) {
        try {
          const chunkDocs = await Promise.all(
            Array.from({ length: chunkCount }, (_, i) => 
              this.db.collection('catalogs').doc(`chunk_${i}`).get()
            )
          );
          chunkDocs.forEach(cDoc => {
            if (cDoc.exists && Array.isArray(cDoc.data()?.products)) {
              remoteProducts.push(...cDoc.data().products);
            }
          });
        } catch (e) {
          console.warn("Erro ao buscar chunks via SDK, buscando via REST...", e);
          remoteProducts = await this.readChunksViaRest(chunkCount);
        }
      } else if (Array.isArray(data.products)) {
        remoteProducts = data.products;
      }

      if (remoteProducts.length > 0) {
        this.applyRemoteProducts(remoteProducts);
      }
    }, err => console.warn("Firestore catalog listen error:", err));

    // Escuta remota de encartes/lâminas de ofertas em tempo real
    this.db.collection('catalogs').doc('laminas').onSnapshot({ includeMetadataChanges: true }, (doc) => {
      if (this.isSyncingFromRemote || !doc.exists) return;
      if (doc.metadata && doc.metadata.hasPendingWrites) return;

      const isGestor = localStorage.getItem('catalog_gestor_logged') === 'true';
      if (isGestor) {
        return;
      }

      const data = doc.data();
      if (data && Array.isArray(data.laminas)) {
        this.applyRemoteLaminas(data.laminas);
      }
    }, err => console.warn("Firestore laminas listen error:", err));
  }

  applyRemoteLaminas(remoteLaminas) {
    const current = this.store.getLaminas() || [];
    const localSig = current.map(l => `${l.id}:${l.validity}:${l.manualPosition || 0}:${(l.imageUrl || '').length}`).join(';');
    const remoteSig = (remoteLaminas || []).map(l => `${l.id}:${l.validity}:${l.manualPosition || 0}:${(l.imageUrl || '').length}`).join(';');

    if (localSig !== remoteSig) {
      console.log(`Recebendo atualização de encartes da nuvem para clientes: ${(remoteLaminas || []).length} encartes.`);
      this.isSyncingFromRemote = true;
      this.store.setAllLaminas(remoteLaminas, 'cloud');
      this.isSyncingFromRemote = false;
    }
  }

  applyRemoteProducts(remoteProducts) {
    // BLINDAGEM TOTAL DE FOTOS: Se o produto local tem foto e a nuvem não tem, PRESERVA A FOTO LOCAL!
    const mergedProducts = remoteProducts.map(remoteP => {
      const localP = this.store.products.find(lp => lp.id === remoteP.id);
      if (localP && localP.imageBase64 && !remoteP.imageBase64) {
        return { ...remoteP, imageBase64: localP.imageBase64 };
      }
      return remoteP;
    });

    const localSig = this.getCatalogSignature(this.store.products);
    const remoteSig = this.getCatalogSignature(mergedProducts);
    // Só atualiza se o conteúdo REAL dos produtos tiver mudado (evita loop infinito e tela piscando)
    if (localSig !== remoteSig) {
      console.log(`Recebendo atualização real da nuvem para clientes: ${mergedProducts.length} produtos.`);
      this.isSyncingFromRemote = true;
      this.store.setAllProducts(mergedProducts, false);
      this.isSyncingFromRemote = false;
    }
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

  // Divide a lista de produtos em blocos que respeitam o limite de 1 MiB do Firestore
  splitProductsIntoChunks(cleanProducts, maxBytesPerChunk = 550000) {
    if (!Array.isArray(cleanProducts) || cleanProducts.length === 0) {
      return [[]];
    }

    const chunks = [];
    let currentChunk = [];
    let currentSize = 0;

    for (const p of cleanProducts) {
      const imgLen = (p.imageBase64 || '').length;
      const descLen = (p.description || '').length;
      const itemSize = imgLen + descLen + 350; // Estimativa com wrapper REST/JSON

      if (currentChunk.length > 0 && (currentSize + itemSize > maxBytesPerChunk)) {
        chunks.push(currentChunk);
        currentChunk = [p];
        currentSize = itemSize;
      } else {
        currentChunk.push(p);
        currentSize += itemSize;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  formatRestProductValue(p) {
    return {
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
    };
  }

  parseRestProducts(docJson) {
    if (!docJson || !docJson.fields || !docJson.fields.products || !docJson.fields.products.arrayValue) {
      return [];
    }
    const values = docJson.fields.products.arrayValue.values || [];
    return values.map(v => {
      const f = v.mapValue?.fields || {};
      return {
        id: f.id?.stringValue || '',
        code: f.code?.stringValue || '',
        description: f.description?.stringValue || '',
        unitPrice: parseFloat(f.unitPrice?.doubleValue ?? f.unitPrice?.integerValue ?? 0) || 0,
        qtyPerBox: parseInt(f.qtyPerBox?.integerValue || 1),
        showBoxTotal: f.showBoxTotal?.booleanValue !== false,
        category: f.category?.stringValue || 'outros',
        active: f.active?.booleanValue !== false,
        manualPosition: parseInt(f.manualPosition?.integerValue || 1),
        imageBase64: f.imageBase64?.stringValue || '',
        promoActive: !!f.promoActive?.booleanValue,
        promoPrice: parseFloat(f.promoPrice?.doubleValue ?? f.promoPrice?.integerValue ?? 0) || 0,
        promoExpiry: f.promoExpiry?.stringValue || ''
      };
    });
  }

  async readChunksViaRest(chunkCount) {
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

    const allProducts = [];
    for (let i = 0; i < chunkCount; i++) {
      try {
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/catalogs/chunk_${i}`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          const items = this.parseRestProducts(json);
          allProducts.push(...items);
        }
      } catch (err) {
        console.warn(`Erro ao carregar chunk_${i} via REST:`, err);
      }
    }
    return allProducts;
  }

  async writeSingleDocViaRest(projectId, docId, products, hidePrices, chunkCount) {
    const restPayload = {
      fields: {
        chunkCount: { integerValue: String(chunkCount || 1) },
        hidePrices: { booleanValue: !!hidePrices },
        products: {
          arrayValue: {
            values: products.map(p => this.formatRestProductValue(p))
          }
        }
      }
    };

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/catalogs/${docId}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(restPayload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Falha HTTP ${res.status}: ${errText}`);
    }
    return true;
  }

  async writeChunkDocViaRest(projectId, docId, products, chunkIndex) {
    const restPayload = {
      fields: {
        chunkIndex: { integerValue: String(chunkIndex || 0) },
        products: {
          arrayValue: {
            values: products.map(p => this.formatRestProductValue(p))
          }
        }
      }
    };

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/catalogs/${docId}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(restPayload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Falha HTTP ${res.status}: ${errText}`);
    }
    return true;
  }

  async writeChunksViaRest(chunks, hidePrices) {
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

    if (chunks.length === 1) {
      await this.writeSingleDocViaRest(projectId, 'active', chunks[0], !!hidePrices, 1);
    } else {
      // Grava cada chunk individualmente
      for (let i = 0; i < chunks.length; i++) {
        await this.writeChunkDocViaRest(projectId, `chunk_${i}`, chunks[i], i);
      }
      // Grava active com metadados do total de chunks
      await this.writeSingleDocViaRest(projectId, 'active', chunks[0], !!hidePrices, chunks.length);
    }

    return chunks.reduce((acc, c) => acc + c.length, 0);
  }

  async writeChunksViaSDK(chunks, hidePrices) {
    const batch = this.db.batch();
    const activeRef = this.db.collection('catalogs').doc('active');

    if (chunks.length === 1) {
      batch.set(activeRef, {
        chunkCount: 1,
        hidePrices: !!hidePrices,
        products: chunks[0],
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      chunks.forEach((chunk, i) => {
        const chunkRef = this.db.collection('catalogs').doc(`chunk_${i}`);
        batch.set(chunkRef, {
          chunkIndex: i,
          products: chunk,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });

      batch.set(activeRef, {
        chunkCount: chunks.length,
        hidePrices: !!hidePrices,
        products: chunks[0],
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    await batch.commit();
    return chunks.reduce((acc, c) => acc + c.length, 0);
  }

  async forcePublishToCloud() {
    if (this.isClientView) {
      throw new Error("Modo cliente é apenas leitura.");
    }

    // 1. OTIMIZAÇÃO PRÉ-PUBLICAÇÃO: Recompacta qualquer imagem pesada no catálogo para ~10KB-15KB
    if (typeof ImageUtils !== 'undefined' && ImageUtils.optimizeAllProductImages) {
      await ImageUtils.optimizeAllProductImages(this.store.products);
      this.store.saveToStorage(false);
    }

    const cleanProducts = (this.store.products || []).map(p => this.sanitizeProductForCloud(p));
    const hidePrices = !!this.store.hidePrices;

    // 2. CHUNKING INTELIGENTE: Divide em blocos caso o tamanho se aproxime do limite de 1 MiB do Firestore
    const chunks = this.splitProductsIntoChunks(cleanProducts, 550000);
    console.log(`Publicando na nuvem: ${cleanProducts.length} produtos em ${chunks.length} bloco(s) Firestore.`);

    // 3. Tenta gravação via SDK
    const sdkPromise = (async () => {
      if (!this.db || !this.firebaseActive) {
        throw new Error("SDK não ativo");
      }
      return await this.writeChunksViaSDK(chunks, hidePrices);
    })();

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("TIMEOUT_SDK")), 4000)
    );

    let resultCount = 0;
    try {
      resultCount = await Promise.race([sdkPromise, timeoutPromise]);
    } catch (err) {
      console.warn("SDK write falhou ou demorou. Usando fallback REST API imediato em chunks...", err);
      resultCount = await this.writeChunksViaRest(chunks, hidePrices);
    }

    // 4. Publicar também encartes/lâminas de ofertas na nuvem
    const currentLaminas = (this.store.getLaminas() || []).map(l => this.sanitizeLaminaForCloud(l));
    try {
      if (this.db && this.firebaseActive) {
        await this.writeLaminasViaSDK(currentLaminas);
      } else {
        await this.writeLaminasViaRest(currentLaminas);
      }
      console.log(`Encartes publicados na nuvem com sucesso: ${currentLaminas.length} encartes.`);
    } catch (errL) {
      console.warn("Publicação de encartes via SDK falhou, tentando via REST...", errL);
      try {
        await this.writeLaminasViaRest(currentLaminas);
        console.log(`Encartes publicados via REST: ${currentLaminas.length} encartes.`);
      } catch (errL2) {
        console.warn("Publicação de encartes via REST também falhou:", errL2);
      }
    }

    return resultCount;
  }

  sanitizeLaminaForCloud(l) {
    return {
      id: String(l.id || ''),
      title: String(l.title || ''),
      imageUrl: String(l.imageUrl || ''),
      validity: String(l.validity || ''),
      description: String(l.description || ''),
      active: l.active !== false,
      manualPosition: parseInt(l.manualPosition) || 1,
      createdAt: String(l.createdAt || new Date().toISOString())
    };
  }

  async writeLaminasViaSDK(laminas) {
    if (!this.db || !this.firebaseActive) throw new Error("SDK não ativo");
    const laminasRef = this.db.collection('catalogs').doc('laminas');
    await laminasRef.set({
      laminas: laminas || [],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  formatRestLaminaValue(l) {
    return {
      mapValue: {
        fields: {
          id: { stringValue: String(l.id || '') },
          title: { stringValue: String(l.title || '') },
          imageUrl: { stringValue: String(l.imageUrl || '') },
          validity: { stringValue: String(l.validity || '') },
          description: { stringValue: String(l.description || '') },
          active: { booleanValue: l.active !== false },
          manualPosition: { integerValue: String(l.manualPosition || 1) },
          createdAt: { stringValue: String(l.createdAt || '') }
        }
      }
    };
  }

  parseRestLaminas(docJson) {
    if (!docJson || !docJson.fields || !docJson.fields.laminas || !docJson.fields.laminas.arrayValue) {
      return [];
    }
    const values = docJson.fields.laminas.arrayValue.values || [];
    return values.map(v => {
      const f = v.mapValue?.fields || {};
      return {
        id: f.id?.stringValue || '',
        title: f.title?.stringValue || '',
        imageUrl: f.imageUrl?.stringValue || '',
        validity: f.validity?.stringValue || '',
        description: f.description?.stringValue || '',
        active: f.active?.booleanValue !== false,
        manualPosition: parseInt(f.manualPosition?.integerValue || 1),
        createdAt: f.createdAt?.stringValue || ''
      };
    });
  }

  async writeLaminasViaRest(laminas) {
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
        laminas: {
          arrayValue: {
            values: (laminas || []).map(l => this.formatRestLaminaValue(l))
          }
        }
      }
    };

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/catalogs/laminas`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(restPayload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Falha HTTP ao salvar encartes: ${errText}`);
    }
    return true;
  }

  async readLaminasViaRest() {
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

    try {
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/catalogs/laminas`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        return this.parseRestLaminas(json);
      }
    } catch (e) {
      console.warn("Erro ao buscar encartes via REST:", e);
    }
    return [];
  }

  async syncLaminasToCloud(laminas) {
    if (this.isClientView) return;
    if (this.cloudLaminasTimeout) clearTimeout(this.cloudLaminasTimeout);

    this.cloudLaminasTimeout = setTimeout(async () => {
      try {
        const cleanLaminas = (laminas || []).map(l => this.sanitizeLaminaForCloud(l));
        if (this.db && this.firebaseActive) {
          await this.writeLaminasViaSDK(cleanLaminas);
        } else {
          await this.writeLaminasViaRest(cleanLaminas);
        }
        console.log("Firestore cloud sync de encartes concluído:", cleanLaminas.length);
      } catch (e) {
        console.warn("Firestore sync encartes erro (tentando REST):", e);
        try {
          const cleanLaminas = (laminas || []).map(l => this.sanitizeLaminaForCloud(l));
          await this.writeLaminasViaRest(cleanLaminas);
        } catch (restErr) {
          console.warn("REST encartes também falhou:", restErr);
        }
      }
    }, 800);
  }

  async syncToCloud(products, hidePrices) {
    if (this.isClientView) return; // Clientes em view=public são estritamente somente-leitura!

    // Debounce cloud sync by 600ms to avoid unnecessary network requests
    if (this.cloudSyncTimeout) clearTimeout(this.cloudSyncTimeout);

    this.cloudSyncTimeout = setTimeout(async () => {
      try {
        const cleanProducts = (products || []).map(p => this.sanitizeProductForCloud(p));
        const hide = !!hidePrices;
        const chunks = this.splitProductsIntoChunks(cleanProducts, 550000);

        const sdkPromise = (async () => {
          if (!this.db || !this.firebaseActive) throw new Error("SDK inativo");
          return await this.writeChunksViaSDK(chunks, hide);
        })();

        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("TIMEOUT")), 4000)
        );

        try {
          await Promise.race([sdkPromise, timeoutPromise]);
          console.log("Firestore cloud sync (SDK) succeeded:", cleanProducts.length, "products synced.");
        } catch (e) {
          console.warn("Firestore sync SDK timeout/erro, tentando via REST...", e);
          try {
            await this.writeChunksViaRest(chunks, hide);
            console.log("Firestore cloud sync (REST) succeeded:", cleanProducts.length, "products synced.");
          } catch (restErr) {
            console.warn("Firestore REST também não completou (dados preservados no armazenamento local):", restErr);
          }
        }
      } catch (e) {
        console.error("Cloud sync error (dados protegidos no localStorage):", e);
      }
    }, 600);
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
      if (this.isLocal) {
        badge.className = 'badge badge-warning';
        badge.innerHTML = '<i class="fa-solid fa-flask"></i> Ambiente de Teste (Local)';
        badge.title = 'Ambiente de testes 100% isolado. Nenhuma modificação sobe para produção automaticamente.';
      } else if (active) {
        badge.className = 'badge badge-active';
        badge.innerHTML = '<i class="fa-solid fa-cloud"></i> Nuvem: Produção';
      } else {
        badge.className = 'badge badge-warning';
        badge.innerHTML = '<i class="fa-solid fa-cloud-slash"></i> Nuvem: Offline';
      }
    }
  }
}
