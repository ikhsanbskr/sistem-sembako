/**
 * Layanan pencatatan Setoran dan pembaruan status Lunas otomatis.
 */

function getSetoranList(filters) {
  requireAuth();
  const f = filters || {};
  const customers = sheetToObjects(SHEET_NAMES.CUSTOMER);
  const custMap = {};
  customers.forEach((c) => {
    custMap[c.id] = c.nama;
  });

  const orders = sheetToObjects(SHEET_NAMES.ORDER);
  const orderMap = {};
  orders.forEach((o) => {
    orderMap[o.id] = o.no_order;
  });

  let rows = sheetToObjects(SHEET_NAMES.SETORAN).map((s) => ({
    id: s.id,
    no_setoran: s.no_setoran,
    tanggal: s.tanggal,
    customer_id: s.customer_id,
    customer_nama: custMap[s.customer_id] || '-',
    order_id: s.order_id,
    no_order: orderMap[s.order_id] || '-',
    nominal: toNumber(s.nominal, 0),
    metode: s.metode || 'Tunai',
    catatan: s.catatan || '',
    dibuat_oleh: s.dibuat_oleh || ''
  }));

  if (f.customer_id) rows = rows.filter((r) => r.customer_id === f.customer_id);
  if (f.order_id) rows = rows.filter((r) => r.order_id === f.order_id);
  if (f.dari_tanggal) rows = rows.filter((r) => String(r.tanggal) >= String(f.dari_tanggal));
  if (f.sampai_tanggal) rows = rows.filter((r) => String(r.tanggal) <= String(f.sampai_tanggal));

  return rows.sort((a, b) => String(b.no_setoran).localeCompare(String(a.no_setoran)));
}

function createSetoran(payload) {
  requireAuth();
  if (!payload || !payload.order_id) throw new Error('Order wajib dipilih.');
  const nominal = toNumber(payload.nominal, 0);
  if (nominal <= 0) throw new Error('Nominal setoran harus lebih dari 0.');

  return withIdempotentLock(payload.request_id, () => {
    const orders = enrichOrdersWithProgress(
      sheetToObjects(SHEET_NAMES.ORDER, true).filter((o) => o.id === payload.order_id)
    );
    if (orders.length === 0) throw new Error('Order tidak ditemukan.');
    const order = orders[0];

    if (order.status === APP_CONFIG.ORDER_STATUS.DIBATALKAN) {
      throw new Error('Tidak dapat mencatat setoran untuk order yang dibatalkan.');
    }
    if (order.sisa_setoran <= 0) {
      throw new Error('Order ini sudah lunas.');
    }
    if (nominal > order.sisa_setoran) {
      throw new Error('Nominal setoran melebihi sisa setoran (' + order.sisa_setoran + ').');
    }

    const tanggal = payload.tanggal ? formatDateIso(payload.tanggal) : formatDateIso(new Date());
    const noSetoran = generateSequentialNumber(SHEET_NAMES.SETORAN, 'no_setoran', 'STR', tanggal);

    const newSetoran = {
      id: generateId('STR'),
      no_setoran: noSetoran,
      tanggal: tanggal,
      customer_id: order.customer_id,
      order_id: order.id,
      nominal: nominal,
      metode: String(payload.metode || 'Tunai').trim(),
      catatan: String(payload.catatan || '').trim()
    };

    appendObjects(SHEET_NAMES.SETORAN, [newSetoran]);

    const sisaBaru = order.sisa_setoran - nominal;
    if (sisaBaru <= 0 && order.status === APP_CONFIG.ORDER_STATUS.BERJALAN) {
      updateObjectByKey(SHEET_NAMES.ORDER, 'id', order.id, {
        status: APP_CONFIG.ORDER_STATUS.LUNAS
      });
    }

    return Object.assign({}, newSetoran, {
      sisa_setoran_baru: Math.max(0, sisaBaru),
      status_order_baru: sisaBaru <= 0 ? APP_CONFIG.ORDER_STATUS.LUNAS : order.status
    });
  });
}
