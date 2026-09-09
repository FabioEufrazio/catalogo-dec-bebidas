/* ==========================================================================
   ExcelEngine
   Smart Excel / CSV Parsing, Column Mapping & Diff Analysis
   ========================================================================== */

class ExcelEngine {
  constructor() {}

  // Parse File (XLSX, XLS, CSV) into Raw Grid
  parseFileToGrid(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          resolve(this.extractHeadersAndGrid(rawRows));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (error) => reject(error);
      reader.readAsArrayBuffer(file);
    });
  }

  // Parse Raw Pasted Text (Tab Separated) into Raw Grid
  parsePastedTextToGrid(text) {
    const lines = text.trim().split(/\r?\n/);
    const rawRows = lines.map(line => line.split('\t'));
    return this.extractHeadersAndGrid(rawRows);
  }

  // Extract Header Candidates & Raw Grid
  extractHeadersAndGrid(rawRows) {
    if (!rawRows || rawRows.length < 1) {
      throw new Error("A planilha está vazia.");
    }

    let headerRowIdx = 0;

    // Search top 10 rows for best header row candidate
    for (let r = 0; r < Math.min(10, rawRows.length); r++) {
      const row = rawRows[r];
      if (Array.isArray(row) && row.some(cell => {
        const text = String(cell || '').toLowerCase();
        return text.includes('seqproduto') || text.includes('desccompleta') || text.includes('codigo') || text.includes('descricao');
      })) {
        headerRowIdx = r;
        break;
      }
    }

    const headerRow = rawRows[headerRowIdx] || [];
    const headers = headerRow.map((cell, idx) => {
      const label = String(cell || '').trim();
      return label ? label : `Coluna ${idx + 1}`;
    });

    // Auto-detect best matching indices with precise keyword priority
    const autoMapped = {
      code: -1,
      description: -1,
      unitPrice: -1,
      boxPrice: -1,
      qtyPerBox: -1
    };

    headers.forEach((h, idx) => {
      const hClean = h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

      // 1. CODE (e.g. SEQPRODUTO, CODIGO, SKU)
      if (autoMapped.code === -1) {
        if (hClean === 'seqproduto' || hClean === 'codproduto' || hClean === 'codigo' || hClean.includes('codigo') || hClean === 'cod' || hClean === 'sku' || hClean === 'item') {
          autoMapped.code = idx;
        }
      }

      // 2. DESCRIPTION (e.g. DESCCOMPLETA, DESCRICAO, PRODUTO - exclude code columns)
      if (autoMapped.description === -1) {
        if ((hClean === 'desccompleta' || hClean.includes('desc') || hClean.includes('nome') || hClean === 'produto' || hClean === 'title') && !hClean.includes('seq') && !hClean.includes('cod')) {
          autoMapped.description = idx;
        }
      }

      // 3. BOX PRICE (specifically containing 'caixa' or 'cx')
      if (autoMapped.boxPrice === -1) {
        if (hClean.includes('caixa') || hClean.includes('cx')) {
          if (hClean.includes('preco') || hClean.includes('preço') || hClean.includes('val') || hClean.includes('pr')) {
            autoMapped.boxPrice = idx;
          }
        }
      }

      // 4. UNIT PRICE (containing 'un' or 'unitario' or 'preco' WITHOUT 'caixa'/'cx')
      if (autoMapped.unitPrice === -1) {
        if ((hClean.includes('un') || hClean.includes('unitario') || hClean.includes('preco') || hClean.includes('preço') || hClean.includes('valor')) && !hClean.includes('caixa') && !hClean.includes('cx')) {
          autoMapped.unitPrice = idx;
        }
      }

      // 5. QTY PER BOX (e.g. QTDEMBALAGEM, EMBALAGEM, CAIXA)
      if (autoMapped.qtyPerBox === -1) {
        if (hClean.includes('qtd') || hClean.includes('embalagem') || hClean.includes('emb') || hClean === 'caixa' || hClean === 'cx') {
          if (!hClean.includes('preco') && !hClean.includes('preço') && !hClean.includes('val')) {
            autoMapped.qtyPerBox = idx;
          }
        }
      }
    });

    return {
      headerRowIdx,
      headers,
      autoMapped,
      rawRows
    };
  }

  // Convert Grid to Items using User Specified Column Mappings
  processItemsWithMapping(rawRows, headerRowIdx, mapping) {
    const itemsMap = new Map();

    for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
      const row = rawRows[r];
      if (!row || row.length === 0) continue;

      const codeVal = mapping.code !== -1 && row[mapping.code] !== undefined ? String(row[mapping.code]).trim() : '';
      const descVal = mapping.description !== -1 && row[mapping.description] !== undefined ? String(row[mapping.description]).trim() : '';

      let rawUnitPrice = mapping.unitPrice !== -1 && row[mapping.unitPrice] !== undefined ? row[mapping.unitPrice] : null;
      let rawBoxPrice = mapping.boxPrice !== -1 && row[mapping.boxPrice] !== undefined ? row[mapping.boxPrice] : null;
      let rawQty = mapping.qtyPerBox !== -1 && row[mapping.qtyPerBox] !== undefined ? row[mapping.qtyPerBox] : 1;

      if (!codeVal && !descVal) continue; // Skip empty row

      const parseNum = (val) => {
        if (val === null || val === undefined) return 0;
        if (typeof val === 'number') return val;
        const str = String(val).replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
        return parseFloat(str) || 0;
      };

      let unitPrice = parseNum(rawUnitPrice);
      const boxPrice = parseNum(rawBoxPrice);
      let qtyPerBox = parseInt(parseNum(rawQty)) || 1;
      if (qtyPerBox <= 0) qtyPerBox = 1;

      // If unit price was empty/0 but box price is present, calculate unit price
      if (unitPrice === 0 && boxPrice > 0) {
        unitPrice = boxPrice / qtyPerBox;
      }

      // Ignore zero price entries if possible
      if (unitPrice <= 0 && boxPrice <= 0) continue;

      const itemKey = codeVal ? codeVal : descVal.toUpperCase();
      const item = {
        code: codeVal,
        description: descVal.toUpperCase(),
        unitPrice: Math.round(unitPrice * 100) / 100,
        qtyPerBox
      };

      if (!itemsMap.has(itemKey)) {
        itemsMap.set(itemKey, item);
      } else {
        // If previous entry had 0 unitPrice and current has valid price, update it
        if (itemsMap.get(itemKey).unitPrice === 0 && item.unitPrice > 0) {
          itemsMap.set(itemKey, item);
        }
      }
    }

    return Array.from(itemsMap.values());
  }

  // Analyze Diff between imported items and current store
  analyzeDiff(importedItems, currentProducts) {
    const updated = [];
    const newItems = [];

    const existingMapByCode = new Map();
    const existingMapByDesc = new Map();

    currentProducts.forEach(p => {
      if (p.code) existingMapByCode.set(String(p.code).trim(), p);
      if (p.description) existingMapByDesc.set(String(p.description).trim().toUpperCase(), p);
    });

    importedItems.forEach(item => {
      let existing = null;
      if (item.code && existingMapByCode.has(item.code)) {
        existing = existingMapByCode.get(item.code);
      } else if (item.description && existingMapByDesc.has(item.description)) {
        existing = existingMapByDesc.get(item.description);
      }

      if (existing) {
        const priceChanged = Math.abs(existing.unitPrice - item.unitPrice) > 0.001;
        const qtyChanged = existing.qtyPerBox !== item.qtyPerBox;
        
        updated.push({
          existing,
          imported: item,
          priceChanged,
          qtyChanged,
          oldPrice: existing.unitPrice,
          newPrice: item.unitPrice,
          oldQty: existing.qtyPerBox,
          newQty: item.qtyPerBox
        });
      } else {
        const category = this.detectCategory(item.description);
        newItems.push({
          ...item,
          category
        });
      }
    });

    return { updated, newItems };
  }

  detectCategory(description) {
    if (!description) return 'outros';
    const text = String(description).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

    // Whiskies & Bourbon
    if (text.includes('whisky') || text.includes('whiskey') || text.includes('jack') || text.includes('label') || text.includes('chivas') || text.includes('parr') || text.includes('ballantine') || text.includes('passport') || text.includes('white horse') || text.includes('buchanan') || text.includes('uisq') || text.includes('bourbon') || text.match(/\bwh\b/)) return 'whiskies';

    // Vodkas
    if (text.includes('vodka') || text.includes('vodk') || text.includes('smirnoff') || text.includes('absolut') || text.includes('ciroc') || text.includes('orloff') || text.includes('askov') || text.includes('grey goose') || text.includes('stolichnaya') || text.includes('ketel')) return 'vodkas';

    // Cervejas & Chopp
    if (text.includes('cerveja') || text.includes('cerv') || text.includes('chopp') || text.includes('heineken') || text.includes('corona') || text.includes('stella') || text.includes('spaten') || text.includes('budweiser') || text.includes('amstel') || text.includes('eisenbahn') || text.includes('becks') || text.includes('skol') || text.includes('brahma') || text.includes('antarctica') || text.includes('petra') || text.includes('itaipava') || text.includes('long neck')) return 'cervejas';

    // Gins
    if (text.includes('gin') || text.includes('tanqueray') || text.includes('bombay') || text.includes('beefeater') || text.includes('gordon') || text.includes('seagers') || text.includes('bulldog') || text.includes('amazoni') || text.includes('toronto')) return 'gins';

    // Vinhos
    if (text.includes('vinho') || text.includes('vin') || text.includes('cabernet') || text.includes('merlot') || text.includes('malbec') || text.includes('chardonnay') || text.includes('sauvignon') || text.includes('tinto') || text.includes('rose') || text.includes('pergola') || text.includes('almaden') || text.includes('santa helena') || text.includes('reservado')) return 'vinhos';

    // Espumantes & Champagne
    if (text.includes('espumante') || text.includes('esp') || text.includes('champagne') || text.includes('champ') || text.includes('prosecco') || text.includes('moscatel') || text.includes('brut') || text.includes('chandon') || text.includes('salton') || text.includes('perini')) return 'espumantes';

    // Licores & Aperitivos
    if (text.includes('licor') || text.includes('lic') || text.includes('baileys') || text.includes('amaretto') || text.includes('jager') || text.includes('stock') || text.includes('fireball') || text.includes('cointreau') || text.includes('curacao') || text.includes('campari') || text.includes('vermouth') || text.includes('martini')) return 'licores';

    // Xaropes
    if (text.includes('xarope') || text.includes('xar') || text.includes('monin') || text.includes('1883') || text.includes('dilute')) return 'xaropes';

    // Água de Coco
    if (text.includes('coco') || text.includes('ducoco') || text.includes('kero') || text.includes('sococo') || text.includes('quadrata')) return 'aguadecoco';

    // Energéticos
    if (text.includes('energ') || text.includes('baly') || text.includes('red bull') || text.includes('monster') || text.includes('vibe') || text.includes('fusion') || text.includes('tnt')) return 'energeticos';

    // Sucos
    if (text.includes('suco') || text.includes('suc') || text.includes('aurora') || text.includes('integral') || text.includes('prats') || text.includes('del valle') || text.includes('maguary') || text.includes('ades')) return 'sucos';

    // Refrigerantes
    if (text.includes('refri') || text.includes('coca') || text.includes('pepsi') || text.includes('guarana') || text.includes('sprite') || text.includes('fanta') || text.includes('tonica') || text.includes('schweppes') || text.includes('soda')) return 'refrigerantes';

    return 'outros';
  }
}

const excelEngine = new ExcelEngine();
