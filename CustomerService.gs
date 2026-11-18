/**
 * Layanan Master Customer dan detail riwayat pesanan/setoran customer.
 */

function getCustomers(includeInactive) {
  requireAuth();
  const rows = sheetToObjects(SHEET_NAMES.CUSTOMER);
  return rows
    .filter((c) => includeInactive || toBoolean(c.aktif, true))
    .map((c) => ({
      id: c.id,
      nama: c.nama || '',
      no_hp: String(c.no_hp || ''),
      alamat: c.alamat || '',
      catatan: c.catatan || '',
      aktif: toBoolean(c.aktif, true),
      dibuat_pada: c.dibuat_pada || ''
    }))
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
}

function saveCustomer(payload) {
  const ctx = requireAuth();
  if (!payload || !String(payload.nama || '').trim()) {
    throw new Error('Nama customer wajib diisi.');
  }

  return withIdempotentLock(payload.request_id, () => {
    const nama = String(payload.nama).trim();
    const noHp = String(payload.no_hp || '').trim();
    const alamat = String(payload.alamat || '').trim();
    const catatan = String(payload.catatan || '').trim();
    const aktif = payload.aktif !== undefined ? toBoolean(payload.aktif, true) : true;

    if (payload.id) {
      if (ctx.role !== APP_CONFIG.USER_ROLE.ADMIN && payload.aktif === false) {
        throw new Error('Staf tidak diizinkan menonaktifkan master customer.');
      }
      return updateObjectByKey(SHEET_NAMES.CUSTOMER, 'id', payload.id, {
        nama: nama,
        no_hp: noHp,
        alamat: alamat,
        catatan: catatan,
        aktif: aktif
      });
    }

    const newCustomer = {
      id: generateId('CST'),
      nama: nama,
      no_hp: noHp,
      alamat: alamat,
      catatan: catatan,
      aktif: true
    };
    appendObjects(SHEET_NAMES.CUSTOMER, [newCustomer]);
    return newCustomer;
  });
}

function toggleCustomerStatus(customerId, aktif) {
  requireAuth(APP_CONFIG.USER_ROLE.ADMIN);
  return withIdempotentLock(payload.request_id, () => {
    return updateObjectByKey(SHEET_NAMES.CUSTOMER, 'id', customerId, { aktif: toBoolean(aktif, true) });
  });
}

function getCustomerDetail(customerId) {
  requireAuth();
  const customers = sheetToObjects(SHEET_NAMES.CUSTOMER);
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) throw new Error('Customer tidak ditemukan.');

  const allOrders = enrichOrdersWithProgress(
    sheetToObjects(SHEET_NAMES.ORDER).filter((o) => o.customer_id === customerId)
  );
  const allSetoran = sheetToObjects(SHEET_NAMES.SETORAN)
    .filter((s) => s.customer_id === customerId)
    .sort((a, b) => String(b.tanggal).localeCompare(String(a.tanggal)));

  let kumulatif = 0;
  const setoranChrono = [...allSetoran].reverse().map((s) => {
    kumulatif += toNumber(s.nominal, 0);
    return Object.assign({}, s, { nominal: toNumber(s.nominal, 0), kumulatif: kumulatif });
  });

  const activeOrders = allOrders.filter((o) => o.status !== APP_CONFIG.ORDER_STATUS.DIBATALKAN);
  const totalPesanan = activeOrders.reduce((acc, o) => acc + o.total, 0);
  const totalSetoran = activeOrders.reduce((acc, o) => acc + o.total_setoran, 0);
  const sisaSetoran = Math.max(0, totalPesanan - totalSetoran);
  const progres = totalPesanan > 0 ? Math.round((totalSetoran / totalPesanan) * 1000) / 10 : 0;

  return {
    customer: {
      id: customer.id,
      nama: customer.nama,
      no_hp: String(customer.no_hp || ''),
      alamat: customer.alamat || '',
      catatan: customer.catatan || '',
      aktif: toBoolean(customer.aktif, true)
    },
    ringkasan: {
      total_pesanan: totalPesanan,
      total_setoran: totalSetoran,
      sisa_setoran: sisaSetoran,
      progres_persen: progres,
      jumlah_order: activeOrders.length
    },
    orders: allOrders,
    setoran: setoranChrono.reverse()
  };
}
