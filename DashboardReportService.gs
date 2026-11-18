/**
 * Layanan Dashboard, Rekapan (Customer, Periode, Kebutuhan Barang, Produk/Paket),
 * Ekspor Google Sheets/CSV, Pengaturan, dan Cadangan Harian Drive.
 */

function getDashboardData() {
  requireAuth();
  const orders = enrichOrdersWithProgress(sheetToObjects(SHEET_NAMES.ORDER));
  const setoranRows = sheetToObjects(SHEET_NAMES.SETORAN);
  const today = formatDateIso(new Date());

  // Awal minggu (Senin) dan awal bulan ini
  const nowDate = new Date();
  const dayOfWeek = nowDate.getDay() === 0 ? 7 : nowDate.getDay();
  const startOfWeek = addDaysIso(today, -(dayOfWeek - 1));
  const startOfMonth = today.slice(0, 7) + '-01';

  const activeOrders = orders.filter((o) => o.status !== APP_CONFIG.ORDER_STATUS.DIBATALKAN);
  const runningOrders = activeOrders.filter((o) => o.status === APP_CONFIG.ORDER_STATUS.BERJALAN);

  const totalPesananBerjalan = runningOrders.reduce((acc, o) => acc + o.total, 0);
  const totalSetoranMasuk = activeOrders.reduce((acc, o) => acc + o.total_setoran, 0);
  const totalSisaSetoran = activeOrders.reduce((acc, o) => acc + o.sisa_setoran, 0);

  // Hitung customer yang seluruh order aktifnya sudah lunas/diserahkan
  const custOrderMap = {};
  activeOrders.forEach((o) => {
    if (!custOrderMap[o.customer_id]) {
      custOrderMap[o.customer_id] = {
        customer_id: o.customer_id,
        customer_nama: o.customer_nama,
        customer_hp: o.customer_hp,
        total_pesanan: 0,
        total_setoran: 0,
        sisa_setoran: 0,
        has_unpaid: false
      };
    }
    const entry = custOrderMap[o.customer_id];
    entry.total_pesanan += o.total;
    entry.total_setoran += o.total_setoran;
    entry.sisa_setoran += o.sisa_setoran;
    if (o.sisa_setoran > 0) entry.has_unpaid = true;
  });

  const jumlahCustomerLunas = Object.values(custOrderMap).filter((c) => !c.has_unpaid && c.total_pesanan > 0).length;

  let setoranMingguIni = 0;
  let setoranBulanIni = 0;
  setoranRows.forEach((s) => {
    const nom = toNumber(s.nominal, 0);
    const tgl = String(s.tanggal || '');
    if (tgl >= startOfWeek && tgl <= today) setoranMingguIni += nom;
    if (tgl >= startOfMonth && tgl <= today) setoranBulanIni += nom;
  });

  const daftarTertinggal = runningOrders
    .filter((o) => o.kekurangan_jadwal > 0)
    .sort((a, b) => b.kekurangan_jadwal - a.kekurangan_jadwal)
    .slice(0, 20);

  const mendekatiJatuhTempo = runningOrders
    .filter((o) => o.hari_menuju_jatuh_tempo <= 30)
    .sort((a, b) => a.hari_menuju_jatuh_tempo - b.hari_menuju_jatuh_tempo)
    .slice(0, 15);

  const topSisaSetoran = Object.values(custOrderMap)
    .filter((c) => c.sisa_setoran > 0)
    .sort((a, b) => b.sisa_setoran - a.sisa_setoran)
    .slice(0, 10);

  return {
    ringkasan: {
      jumlah_order_berjalan: runningOrders.length,
      total_pesanan_berjalan: totalPesananBerjalan,
      total_setoran_masuk: totalSetoranMasuk,
      total_sisa_setoran: totalSisaSetoran,
      jumlah_customer_lunas: jumlahCustomerLunas,
      setoran_minggu_ini: setoranMingguIni,
      setoran_bulan_ini: setoranBulanIni
    },
    daftar_tertinggal: daftarTertinggal,
    mendekati_jatuh_tempo: mendekatiJatuhTempo,
    top_sisa_setoran: topSisaSetoran
  };
}

function getIsoWeekKey(dateStr) {
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3) return dateStr;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
}

function getRekapanData(filters) {
  requireAuth();
  const f = filters || {};
  let orders = enrichOrdersWithProgress(sheetToObjects(SHEET_NAMES.ORDER));

  if (f.status && f.status !== 'ALL') {
    orders = orders.filter((o) => o.status === f.status);
  } else {
    orders = orders.filter((o) => o.status !== APP_CONFIG.ORDER_STATUS.DIBATALKAN);
  }
  if (f.customer_id) orders = orders.filter((o) => o.customer_id === f.customer_id);
  if (f.dari_tanggal) orders = orders.filter((o) => String(o.tanggal) >= String(f.dari_tanggal));
  if (f.sampai_tanggal) orders = orders.filter((o) => String(o.tanggal) <= String(f.sampai_tanggal));

  // 1. Rekap per customer
  const perCustMap = {};
  orders.forEach((o) => {
    if (!perCustMap[o.customer_id]) {
      perCustMap[o.customer_id] = {
        customer_id: o.customer_id,
        customer_nama: o.customer_nama,
        jumlah_order: 0,
        total_pesanan: 0,
        total_setoran: 0,
        sisa_setoran: 0,
        progres_persen: 0
      };
    }
    const c = perCustMap[o.customer_id];
    c.jumlah_order += 1;
    c.total_pesanan += o.total;
    c.total_setoran += o.total_setoran;
    c.sisa_setoran += o.sisa_setoran;
  });

  const perCustomer = Object.values(perCustMap)
    .map((c) => {
      c.progres_persen = c.total_pesanan > 0 ? Math.round((c.total_setoran / c.total_pesanan) * 1000) / 10 : 0;
      return c;
    })
    .sort((a, b) => a.customer_nama.localeCompare(b.customer_nama, 'id'));

  // 2. Rekap setoran per periode
  const periodeMode = f.periode || 'bulanan';
  let setoranRows = sheetToObjects(SHEET_NAMES.SETORAN);
  if (f.customer_id) setoranRows = setoranRows.filter((s) => s.customer_id === f.customer_id);
  if (f.dari_tanggal) setoranRows = setoranRows.filter((s) => String(s.tanggal) >= String(f.dari_tanggal));
  if (f.sampai_tanggal) setoranRows = setoranRows.filter((s) => String(s.tanggal) <= String(f.sampai_tanggal));

  const perPeriodeMap = {};
  setoranRows.forEach((s) => {
    const tgl = String(s.tanggal || '');
    let key = tgl;
    if (periodeMode === 'bulanan') key = tgl.slice(0, 7);
    else if (periodeMode === 'mingguan') key = getIsoWeekKey(tgl);

    if (!perPeriodeMap[key]) {
      perPeriodeMap[key] = { periode: key, jumlah_transaksi: 0, total_nominal: 0 };
    }
    perPeriodeMap[key].jumlah_transaksi += 1;
    perPeriodeMap[key].total_nominal += toNumber(s.nominal, 0);
  });
  const perPeriode = Object.values(perPeriodeMap).sort((a, b) => String(b.periode).localeCompare(String(a.periode)));

  // 3. Rekap kebutuhan barang (pecah paket -> produk) & 4. Rekap per produk/paket
  const orderIds = new Set(orders.map((o) => o.id));
  const orderItems = sheetToObjects(SHEET_NAMES.ORDER_ITEM).filter((it) => orderIds.has(it.order_id));

  const produkMap = {};
  sheetToObjects(SHEET_NAMES.PRODUK).forEach((p) => {
    produkMap[p.id] = p;
  });
  const paketItemsByPaket = {};
  sheetToObjects(SHEET_NAMES.PAKET_ITEM).forEach((pi) => {
    if (!paketItemsByPaket[pi.paket_id]) paketItemsByPaket[pi.paket_id] = [];
    paketItemsByPaket[pi.paket_id].push(pi);
  });

  const kebutuhanMap = {};
  const perItemMap = {};

  function addKebutuhan(produkId, qty, fallbackNama) {
    const prod = produkMap[produkId] || {};
    if (!kebutuhanMap[produkId]) {
      kebutuhanMap[produkId] = {
        produk_id: produkId,
        kode: String(prod.kode || '-'),
        nama: prod.nama || fallbackNama || '(Produk)',
        satuan: prod.satuan || 'pcs',
        total_qty: 0
      };
    }
    kebutuhanMap[produkId].total_qty += qty;
  }

  orderItems.forEach((it) => {
    const qty = toNumber(it.qty, 0);
    const subtotal = toNumber(it.subtotal, 0);
    const itemKey = it.tipe + ':' + it.ref_id;

    if (!perItemMap[itemKey]) {
      perItemMap[itemKey] = {
        tipe: it.tipe,
        ref_id: it.ref_id,
        nama: it.nama,
        total_qty: 0,
        total_nilai: 0
      };
    }
    perItemMap[itemKey].total_qty += qty;
    perItemMap[itemKey].total_nilai += subtotal;

    if (it.tipe === 'paket') {
      const isi = paketItemsByPaket[it.ref_id] || [];
      isi.forEach((pi) => {
        addKebutuhan(pi.produk_id, qty * toNumber(pi.qty, 0), '');
      });
    } else {
      addKebutuhan(it.ref_id, qty, it.nama);
    }
  });

  const kebutuhanBarang = Object.values(kebutuhanMap).sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
  const perProdukPaket = Object.values(perItemMap).sort((a, b) => b.total_nilai - a.total_nilai);

  return {
    per_customer: perCustomer,
    per_periode: perPeriode,
    kebutuhan_barang: kebutuhanBarang,
    per_produk_paket: perProdukPaket
  };
}

function buildCsvContent(headers, rows) {
  const escape = (val) => {
    const s = String(val === null || val === undefined ? '' : val);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
}

function getRekapanCsv(type, filters) {
  const data = getRekapanData(filters);
  if (type === 'customer') {
    return buildCsvContent(
      ['Customer', 'Jumlah Order', 'Total Pesanan', 'Total Setoran', 'Sisa Setoran', 'Progres (%)'],
      data.per_customer.map((r) => [r.customer_nama, r.jumlah_order, r.total_pesanan, r.total_setoran, r.sisa_setoran, r.progres_persen])
    );
  }
  if (type === 'periode') {
    return buildCsvContent(
      ['Periode', 'Jumlah Transaksi', 'Total Setoran'],
      data.per_periode.map((r) => [r.periode, r.jumlah_transaksi, r.total_nominal])
    );
  }
  if (type === 'item') {
    return buildCsvContent(
      ['Tipe', 'Nama Item', 'Total Qty', 'Total Nilai'],
      data.per_produk_paket.map((r) => [r.tipe, r.nama, r.total_qty, r.total_nilai])
    );
  }
  return buildCsvContent(
    ['Kode', 'Nama Produk', 'Satuan', 'Total Kebutuhan Qty'],
    data.kebutuhan_barang.map((r) => [r.kode, r.nama, r.satuan, r.total_qty])
  );
}

function exportRekapanToSheet(filters) {
  requireAuth();
  const data = getRekapanData(filters);
  const stamp = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyyMMdd-HHmm');
  const ss = SpreadsheetApp.create('Rekapan Pengadaan Sembako ' + stamp);

  const writeTable = (sheet, headers, rows) => {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e2e8f0');
    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
    sheet.autoResizeColumns(1, headers.length);
  };

  const s1 = ss.getActiveSheet();
  s1.setName('Kebutuhan Barang');
  writeTable(
    s1,
    ['Kode', 'Nama Produk', 'Satuan', 'Total Qty'],
    data.kebutuhan_barang.map((r) => [r.kode, r.nama, r.satuan, r.total_qty])
  );

  const s2 = ss.insertSheet('Per Customer');
  writeTable(
    s2,
    ['Customer', 'Jumlah Order', 'Total Pesanan', 'Total Setoran', 'Sisa Setoran', 'Progres (%)'],
    data.per_customer.map((r) => [r.customer_nama, r.jumlah_order, r.total_pesanan, r.total_setoran, r.sisa_setoran, r.progres_persen])
  );

  const s3 = ss.insertSheet('Per Periode');
  writeTable(
    s3,
    ['Periode', 'Jumlah Transaksi', 'Total Nominal'],
    data.per_periode.map((r) => [r.periode, r.jumlah_transaksi, r.total_nominal])
  );

  const s4 = ss.insertSheet('Per Produk & Paket');
  writeTable(
    s4,
    ['Tipe', 'Nama Item', 'Total Qty', 'Total Nilai'],
    data.per_produk_paket.map((r) => [r.tipe, r.nama, r.total_qty, r.total_nilai])
  );

  return { url: ss.getUrl(), name: ss.getName() };
}

function getSettings() {
  requireAuth(APP_CONFIG.USER_ROLE.ADMIN);
  const rows = sheetToObjects(SHEET_NAMES.PENGATURAN, true);
  return rows.map((r) => ({
    key: r.key,
    value: String(r.value !== undefined ? r.value : ''),
    keterangan: r.keterangan || ''
  }));
}

function saveSettings(entries) {
  requireAuth(APP_CONFIG.USER_ROLE.ADMIN);
  if (!Array.isArray(entries)) throw new Error('Format pengaturan tidak valid.');

  return withLock(() => {
    const existing = sheetToObjects(SHEET_NAMES.PENGATURAN, true);
    const existingKeys = new Set(existing.map((e) => String(e.key)));

    entries.forEach((item) => {
      if (!item.key) return;
      if (existingKeys.has(item.key)) {
        updateObjectByKey(SHEET_NAMES.PENGATURAN, 'key', item.key, {
          value: String(item.value !== undefined ? item.value : '')
        });
      } else {
        appendObjects(SHEET_NAMES.PENGATURAN, [
          {
            key: item.key,
            value: String(item.value !== undefined ? item.value : ''),
            keterangan: item.keterangan || ''
          }
        ]);
      }
    });
    return getSettings();
  });
}

/**
 * Mencadangkan file Spreadsheet database ke folder Google Drive yang dikonfigurasi.
 * Dapat dijalankan manual atau lewat Time-driven Trigger harian.
 */
function runDailyBackup() {
  const ss = getSpreadsheet();
  const file = DriveApp.getFileById(ss.getId());
  const folderId = getSettingValue('backup_folder_id', '').trim();
  const stamp = Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyy-MM-dd_HHmm');
  const backupName = 'Backup_' + ss.getName() + '_' + stamp;

  let copy;
  if (folderId) {
    const folder = DriveApp.getFolderById(folderId);
    copy = file.makeCopy(backupName, folder);
  } else {
    copy = file.makeCopy(backupName);
  }

  return { id: copy.getId(), name: copy.getName(), url: copy.getUrl() };
}

function setupDailyBackupTrigger() {
  requireAuth(APP_CONFIG.USER_ROLE.ADMIN);
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach((t) => {
    if (t.getHandlerFunction() === 'runDailyBackup') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runDailyBackup').timeBased().everyDays(1).atHour(2).create();
  return true;
}
