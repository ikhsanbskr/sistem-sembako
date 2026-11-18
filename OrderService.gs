/**
 * Layanan Order, perhitungan target & progres setoran, serta Penyerahan Barang.
 */

function enrichOrdersWithProgress(orders) {
  const customers = sheetToObjects(SHEET_NAMES.CUSTOMER);
  const custMap = {};
  customers.forEach((c) => {
    custMap[c.id] = c;
  });

  const setoranRows = sheetToObjects(SHEET_NAMES.SETORAN);
  const setoranPerOrder = {};
  setoranRows.forEach((s) => {
    const oid = s.order_id;
    setoranPerOrder[oid] = (setoranPerOrder[oid] || 0) + toNumber(s.nominal, 0);
  });

  const today = formatDateIso(new Date());

  return orders.map((o) => {
    const total = toNumber(o.total, 0);
    const totalSetoran = setoranPerOrder[o.id] || 0;
    const sisaSetoran = Math.max(0, total - totalSetoran);
    const progresPersen = total > 0 ? Math.min(100, Math.round((totalSetoran / total) * 1000) / 10) : 0;

    const mingguTotal = Math.max(1, toNumber(o.jatuh_tempo_minggu, APP_CONFIG.DEFAULT_JATUH_TEMPO_MINGGU));
    const targetPerMinggu = toNumber(o.target_per_minggu, Math.round(total / mingguTotal));
    const daysElapsed = Math.max(0, diffDaysIso(o.tanggal, today));
    const mingguBerjalan = Math.min(mingguTotal, Math.floor(daysElapsed / 7));
    const setoranIdeal = Math.min(total, Math.round(targetPerMinggu * mingguBerjalan));
    const kekuranganJadwal = o.status === APP_CONFIG.ORDER_STATUS.DIBATALKAN
      ? 0
      : Math.max(0, setoranIdeal - totalSetoran);

    const daysToDue = diffDaysIso(today, o.tgl_jatuh_tempo);
    let penanda = 'Sesuai jadwal';
    if (o.status === APP_CONFIG.ORDER_STATUS.DIBATALKAN) {
      penanda = 'Dibatalkan';
    } else if (sisaSetoran <= 0 || o.status === APP_CONFIG.ORDER_STATUS.LUNAS || o.status === APP_CONFIG.ORDER_STATUS.SUDAH_DISERAHKAN) {
      penanda = 'Lunas';
    } else if (o.tgl_jatuh_tempo && today > o.tgl_jatuh_tempo) {
      penanda = 'Melewati jatuh tempo';
    } else if (kekuranganJadwal > 0) {
      penanda = 'Tertinggal';
    }

    const cust = custMap[o.customer_id] || {};
    return Object.assign({}, o, {
      customer_nama: cust.nama || '(Customer tidak ditemukan)',
      customer_hp: String(cust.no_hp || ''),
      subtotal: toNumber(o.subtotal, total),
      diskon: toNumber(o.diskon, 0),
      ongkir: toNumber(o.ongkir, 0),
      total: total,
      jatuh_tempo_minggu: mingguTotal,
      target_per_minggu: targetPerMinggu,
      total_setoran: totalSetoran,
      sisa_setoran: sisaSetoran,
      progres_persen: progresPersen,
      minggu_berjalan: mingguBerjalan,
      setoran_ideal: setoranIdeal,
      kekurangan_jadwal: kekuranganJadwal,
      hari_menuju_jatuh_tempo: daysToDue,
      penanda: penanda
    });
  });
}

function getOrders(filters) {
  requireAuth();
  const f = filters || {};
  let orders = enrichOrdersWithProgress(sheetToObjects(SHEET_NAMES.ORDER));

  if (f.status && f.status !== 'ALL') {
    orders = orders.filter((o) => o.status === f.status);
  }
  if (f.customer_id) {
    orders = orders.filter((o) => o.customer_id === f.customer_id);
  }
  if (f.dari_tanggal) {
    orders = orders.filter((o) => String(o.tanggal) >= String(f.dari_tanggal));
  }
  if (f.sampai_tanggal) {
    orders = orders.filter((o) => String(o.tanggal) <= String(f.sampai_tanggal));
  }

  return orders.sort((a, b) => String(b.no_order).localeCompare(String(a.no_order)));
}

function getOrderDetail(orderId) {
  requireAuth();
  const orders = enrichOrdersWithProgress(sheetToObjects(SHEET_NAMES.ORDER).filter((o) => o.id === orderId));
  if (orders.length === 0) throw new Error('Order tidak ditemukan.');

  const items = sheetToObjects(SHEET_NAMES.ORDER_ITEM).filter((it) => it.order_id === orderId);
  const setoran = sheetToObjects(SHEET_NAMES.SETORAN)
    .filter((s) => s.order_id === orderId)
    .sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));

  let kumulatif = 0;
  const setoranDenganKumulatif = setoran.map((s) => {
    kumulatif += toNumber(s.nominal, 0);
    return Object.assign({}, s, { nominal: toNumber(s.nominal, 0), kumulatif: kumulatif });
  });

  return {
    order: orders[0],
    items: items.map((it) => Object.assign({}, it, {
      qty: toNumber(it.qty, 0),
      harga: toNumber(it.harga, 0),
      subtotal: toNumber(it.subtotal, 0)
    })),
    setoran: setoranDenganKumulatif.reverse()
  };
}

function computeDueDates(tanggal, jatuhTempoMinggu, tglJatuhTempoInput) {
  const defaultMinggu = toNumber(
    getSettingValue('default_minggu_jatuh_tempo', APP_CONFIG.DEFAULT_JATUH_TEMPO_MINGGU),
    APP_CONFIG.DEFAULT_JATUH_TEMPO_MINGGU
  );

  if (tglJatuhTempoInput) {
    const diff = diffDaysIso(tanggal, tglJatuhTempoInput);
    if (diff < 1) throw new Error('Tanggal jatuh tempo harus setelah tanggal order.');
    const minggu = Math.max(1, Math.ceil(diff / 7));
    return { jatuh_tempo_minggu: minggu, tgl_jatuh_tempo: formatDateIso(tglJatuhTempoInput) };
  }

  const minggu = Math.max(1, toNumber(jatuhTempoMinggu, defaultMinggu));
  const tglJatuhTempo = addDaysIso(tanggal, minggu * 7);
  return { jatuh_tempo_minggu: minggu, tgl_jatuh_tempo: tglJatuhTempo };
}

function createOrder(payload) {
  requireAuth();
  if (!payload || !payload.customer_id) throw new Error('Customer wajib dipilih.');
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) throw new Error('Minimal harus ada 1 item produk atau paket.');

  return withIdempotentLock(payload.request_id, () => {
    const customers = sheetToObjects(SHEET_NAMES.CUSTOMER, true);
    const customer = customers.find((c) => c.id === payload.customer_id);
    if (!customer) throw new Error('Customer tidak ditemukan.');

    const tanggal = payload.tanggal ? formatDateIso(payload.tanggal) : formatDateIso(new Date());
    const due = computeDueDates(tanggal, payload.jatuh_tempo_minggu, payload.tgl_jatuh_tempo);

    const produkMap = {};
    sheetToObjects(SHEET_NAMES.PRODUK, true).forEach((p) => {
      produkMap[p.id] = p;
    });
    const paketMap = {};
    sheetToObjects(SHEET_NAMES.PAKET, true).forEach((pk) => {
      paketMap[pk.id] = pk;
    });

    let subtotalItems = 0;
    const orderId = generateId('ORD');
    const orderItems = items.map((it) => {
      const tipe = it.tipe === 'paket' ? 'paket' : 'produk';
      const ref = tipe === 'paket' ? paketMap[it.ref_id] : produkMap[it.ref_id];
      if (!ref) throw new Error('Item ' + tipe + ' tidak ditemukan.');

      const qty = toNumber(it.qty, 0);
      if (qty <= 0) throw new Error('Qty item harus lebih dari 0.');

      // Snapshot harga saat transaksi:
      // - Untuk paket: harga master adalah harga_per_minggu, sehingga harga per paket = harga_per_minggu * jatuh_tempo_minggu
      // - Untuk produk: harga satuan diisi manual di form order (default 0)
      let harga;
      if (tipe === 'paket') {
        const masterWeekly = toNumber(ref.harga_per_minggu !== undefined ? ref.harga_per_minggu : ref.harga, 0);
        const hargaPerMinggu = it.harga_per_minggu !== undefined && it.harga_per_minggu !== ''
          ? toNumber(it.harga_per_minggu, 0)
          : masterWeekly;
        if (hargaPerMinggu < 0) throw new Error('Harga paket per minggu tidak valid.');
        harga = hargaPerMinggu * due.jatuh_tempo_minggu;
      } else {
        harga = it.harga !== undefined && it.harga !== '' ? toNumber(it.harga, 0) : 0;
        if (harga < 0) throw new Error('Harga item tidak valid.');
      }
      const subtotal = qty * harga;
      subtotalItems += subtotal;

      return {
        id: generateId('ORI'),
        order_id: orderId,
        tipe: tipe,
        ref_id: ref.id,
        nama: ref.nama,
        qty: qty,
        harga: harga,
        subtotal: subtotal
      };
    });

    const diskon = Math.max(0, toNumber(payload.diskon, 0));
    const ongkir = Math.max(0, toNumber(payload.ongkir, 0));
    const total = Math.max(0, subtotalItems - diskon + ongkir);
    const targetPerMinggu = Math.round(total / due.jatuh_tempo_minggu);
    const noOrder = generateSequentialNumber(SHEET_NAMES.ORDER, 'no_order', 'ORD', tanggal);

    const newOrder = {
      id: orderId,
      no_order: noOrder,
      tanggal: tanggal,
      customer_id: customer.id,
      subtotal: subtotalItems,
      diskon: diskon,
      ongkir: ongkir,
      total: total,
      jatuh_tempo_minggu: due.jatuh_tempo_minggu,
      tgl_jatuh_tempo: due.tgl_jatuh_tempo,
      target_per_minggu: targetPerMinggu,
      status: total === 0 ? APP_CONFIG.ORDER_STATUS.LUNAS : APP_CONFIG.ORDER_STATUS.BERJALAN,
      tgl_serah: '',
      penerima_serah: '',
      catatan_serah: '',
      catatan: String(payload.catatan || '').trim()
    };

    appendObjects(SHEET_NAMES.ORDER, [newOrder]);
    appendObjects(SHEET_NAMES.ORDER_ITEM, orderItems);

    return Object.assign({}, newOrder, { items: orderItems });
  });
}

function cancelOrder(orderId, forceConfirm) {
  const ctx = requireAuth();
  return withLock(() => {
    const orders = sheetToObjects(SHEET_NAMES.ORDER, true);
    const order = orders.find((o) => o.id === orderId);
    if (!order) throw new Error('Order tidak ditemukan.');
    if (order.status === APP_CONFIG.ORDER_STATUS.SUDAH_DISERAHKAN) {
      throw new Error('Order yang sudah diserahkan tidak dapat dibatalkan.');
    }

    const setorans = sheetToObjects(SHEET_NAMES.SETORAN, true).filter((s) => s.order_id === orderId);
    if (setorans.length > 0 && !(forceConfirm && ctx.role === APP_CONFIG.USER_ROLE.ADMIN)) {
      throw new Error('Order sudah memiliki riwayat setoran. Pembatalan memerlukan konfirmasi Admin.');
    }

    return updateObjectByKey(SHEET_NAMES.ORDER, 'id', orderId, {
      status: APP_CONFIG.ORDER_STATUS.DIBATALKAN
    });
  });
}

function deleteOrder(orderId) {
  requireAuth(APP_CONFIG.USER_ROLE.ADMIN);
  return withLock(() => {
    const setorans = sheetToObjects(SHEET_NAMES.SETORAN, true).filter((s) => s.order_id === orderId);
    if (setorans.length > 0) {
      throw new Error('Order yang sudah memiliki setoran tidak boleh dihapus (sesuai aturan bisnis).');
    }
    deleteObjectsByKey(SHEET_NAMES.ORDER_ITEM, 'order_id', orderId);
    const deleted = deleteObjectsByKey(SHEET_NAMES.ORDER, 'id', orderId);
    if (deleted === 0) throw new Error('Order tidak ditemukan.');
    return true;
  });
}

function deliverOrder(payload) {
  const ctx = requireAuth();
  if (!payload || !payload.order_id) throw new Error('Order wajib dipilih.');

  return withLock(() => {
    const enriched = enrichOrdersWithProgress(
      sheetToObjects(SHEET_NAMES.ORDER, true).filter((o) => o.id === payload.order_id)
    );
    if (enriched.length === 0) throw new Error('Order tidak ditemukan.');
    const order = enriched[0];

    if (order.status === APP_CONFIG.ORDER_STATUS.DIBATALKAN) {
      throw new Error('Order yang dibatalkan tidak dapat diserahkan.');
    }
    if (order.status === APP_CONFIG.ORDER_STATUS.SUDAH_DISERAHKAN) {
      throw new Error('Order ini sudah tercatat diserahkan.');
    }
    if (order.sisa_setoran > 0 && !(payload.force_unpaid && ctx.role === APP_CONFIG.USER_ROLE.ADMIN)) {
      throw new Error('Order belum lunas (sisa setoran masih ada). Hanya Admin yang dapat menyetujui penyerahan khusus.');
    }

    const tglSerah = payload.tgl_serah ? formatDateIso(payload.tgl_serah) : formatDateIso(new Date());
    return updateObjectByKey(SHEET_NAMES.ORDER, 'id', order.id, {
      status: APP_CONFIG.ORDER_STATUS.SUDAH_DISERAHKAN,
      tgl_serah: tglSerah,
      penerima_serah: String(payload.penerima_serah || '').trim(),
      catatan_serah: String(payload.catatan_serah || '').trim()
    });
  });
}
