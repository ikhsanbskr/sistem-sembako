/**
 * Layanan Master Produk dan Paket Sembako.
 */

function getProducts(includeInactive) {
  requireAuth();
  const rows = sheetToObjects(SHEET_NAMES.PRODUK);
  return rows
    .filter((p) => includeInactive || toBoolean(p.aktif, true))
    .map((p) => ({
      id: p.id,
      kode: String(p.kode || ''),
      nama: p.nama || '',
      satuan: p.satuan || 'pcs',
      aktif: toBoolean(p.aktif, true)
    }))
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
}

function saveProduct(payload) {
  requireAuth(APP_CONFIG.USER_ROLE.ADMIN);
  if (!payload || !String(payload.nama || '').trim()) {
    throw new Error('Nama produk wajib diisi.');
  }

  return withIdempotentLock(payload.request_id, () => {
    const data = {
      kode: String(payload.kode || '').trim() || generateId('PRD'),
      nama: String(payload.nama).trim(),
      satuan: String(payload.satuan || 'pcs').trim(),
      aktif: payload.aktif !== undefined ? toBoolean(payload.aktif, true) : true
    };

    if (payload.id) {
      return updateObjectByKey(SHEET_NAMES.PRODUK, 'id', payload.id, data);
    }

    const newProduct = Object.assign({ id: generateId('PRD') }, data);
    appendObjects(SHEET_NAMES.PRODUK, [newProduct]);
    return newProduct;
  });
}

function toggleProductStatus(productId, aktif) {
  requireAuth(APP_CONFIG.USER_ROLE.ADMIN);
  return withIdempotentLock(payload.request_id, () => {
    return updateObjectByKey(SHEET_NAMES.PRODUK, 'id', productId, { aktif: toBoolean(aktif, true) });
  });
}

function getPackages(includeInactive) {
  requireAuth();
  const paketRows = sheetToObjects(SHEET_NAMES.PAKET);
  const itemRows = sheetToObjects(SHEET_NAMES.PAKET_ITEM);
  const produkMap = {};
  sheetToObjects(SHEET_NAMES.PRODUK).forEach((p) => {
    produkMap[p.id] = p;
  });

  return paketRows
    .filter((pk) => includeInactive || toBoolean(pk.aktif, true))
    .map((pk) => {
      const items = itemRows
        .filter((it) => it.paket_id === pk.id)
        .map((it) => {
          const prod = produkMap[it.produk_id] || {};
          const qty = toNumber(it.qty, 0);
          return {
            id: it.id,
            produk_id: it.produk_id,
            produk_nama: prod.nama || '(Produk dihapus)',
            satuan: prod.satuan || '',
            qty: qty
          };
        });

      const hargaPerMinggu = toNumber(pk.harga_per_minggu !== undefined ? pk.harga_per_minggu : pk.harga, 0);

      return {
        id: pk.id,
        nama: pk.nama || '',
        harga_per_minggu: hargaPerMinggu,
        aktif: toBoolean(pk.aktif, true),
        items: items
      };
    })
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
}

function savePackage(payload) {
  requireAuth(APP_CONFIG.USER_ROLE.ADMIN);
  if (!payload || !String(payload.nama || '').trim()) {
    throw new Error('Nama paket wajib diisi.');
  }
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    throw new Error('Paket harus memiliki minimal 1 produk isi.');
  }
  const hargaPerMinggu = toNumber(payload.harga_per_minggu, -1);
  if (hargaPerMinggu < 0) {
    throw new Error('Harga paket per minggu wajib diisi dan tidak boleh negatif.');
  }

  return withIdempotentLock(payload.request_id, () => {
    const produkMap = {};
    sheetToObjects(SHEET_NAMES.PRODUK, true).forEach((p) => {
      produkMap[p.id] = p;
    });

    const validItems = items.map((it) => {
      const prod = produkMap[it.produk_id];
      if (!prod) throw new Error('Produk dalam paket tidak ditemukan.');
      const qty = toNumber(it.qty, 0);
      if (qty <= 0) throw new Error('Qty produk dalam paket harus lebih dari 0.');
      return { produk_id: it.produk_id, qty: qty };
    });

    let paketId = payload.id;
    const paketData = {
      nama: String(payload.nama).trim(),
      harga_per_minggu: hargaPerMinggu,
      aktif: payload.aktif !== undefined ? toBoolean(payload.aktif, true) : true
    };

    if (paketId) {
      updateObjectByKey(SHEET_NAMES.PAKET, 'id', paketId, paketData);
      deleteObjectsByKey(SHEET_NAMES.PAKET_ITEM, 'paket_id', paketId);
    } else {
      paketId = generateId('PKT');
      appendObjects(SHEET_NAMES.PAKET, [Object.assign({ id: paketId }, paketData)]);
    }

    const paketItems = validItems.map((it) => ({
      id: generateId('PKI'),
      paket_id: paketId,
      produk_id: it.produk_id,
      qty: it.qty
    }));
    appendObjects(SHEET_NAMES.PAKET_ITEM, paketItems);

    return { id: paketId, nama: paketData.nama, harga_per_minggu: hargaPerMinggu };
  });
}

function togglePackageStatus(paketId, aktif) {
  requireAuth(APP_CONFIG.USER_ROLE.ADMIN);
  return withIdempotentLock(payload.request_id, () => {
    return updateObjectByKey(SHEET_NAMES.PAKET, 'id', paketId, { aktif: toBoolean(aktif, true) });
  });
}
