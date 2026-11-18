/**
 * Konfigurasi global, skema sheet, dan inisialisasi database Google Sheets.
 */

const APP_CONFIG = {
  APP_NAME: 'Sistem Pengadaan Sembako',
  TIMEZONE: 'Asia/Jakarta',
  CACHE_TTL_SECONDS: 300,
  DEFAULT_JATUH_TEMPO_MINGGU: 46,
  ORDER_STATUS: {
    BERJALAN: 'Berjalan',
    LUNAS: 'Lunas',
    SUDAH_DISERAHKAN: 'Sudah Diserahkan',
    DIBATALKAN: 'Dibatalkan'
  },
  USER_ROLE: {
    ADMIN: 'admin',
    STAF: 'staf'
  }
};

const SHEET_NAMES = {
  CUSTOMER: 'Customer',
  PRODUK: 'Produk',
  PAKET: 'Paket',
  PAKET_ITEM: 'Paket_Item',
  ORDER: 'Order',
  ORDER_ITEM: 'Order_Item',
  SETORAN: 'Setoran',
  PENGATURAN: 'Pengaturan'
};

const AUDIT_COLUMNS = ['dibuat_oleh', 'dibuat_pada', 'diubah_pada'];

const SHEET_SCHEMAS = {
  Customer: ['id', 'nama', 'no_hp', 'alamat', 'catatan', 'aktif', ...AUDIT_COLUMNS],
  Produk: ['id', 'kode', 'nama', 'satuan', 'aktif', ...AUDIT_COLUMNS],
  Paket: ['id', 'nama', 'harga_per_minggu', 'aktif', ...AUDIT_COLUMNS],
  Paket_Item: ['id', 'paket_id', 'produk_id', 'qty', ...AUDIT_COLUMNS],
  Order: [
    'id',
    'no_order',
    'tanggal',
    'customer_id',
    'subtotal',
    'diskon',
    'ongkir',
    'total',
    'jatuh_tempo_minggu',
    'tgl_jatuh_tempo',
    'target_per_minggu',
    'status',
    'tgl_serah',
    'penerima_serah',
    'catatan_serah',
    'catatan',
    ...AUDIT_COLUMNS
  ],
  Order_Item: ['id', 'order_id', 'tipe', 'ref_id', 'nama', 'qty', 'harga', 'subtotal', ...AUDIT_COLUMNS],
  Setoran: ['id', 'no_setoran', 'tanggal', 'customer_id', 'order_id', 'nominal', 'metode', 'catatan', ...AUDIT_COLUMNS],
  Pengaturan: ['key', 'value', 'keterangan', ...AUDIT_COLUMNS]
};

/**
 * Mengambil instance Spreadsheet aktif (Container-bound) atau berdasarkan
 * Script Property `SPREADSHEET_ID` (Standalone Web App).
 */
function getSpreadsheet() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;

  const props = PropertiesService.getScriptProperties();
  const ssId = props.getProperty('SPREADSHEET_ID');
  if (ssId) {
    return SpreadsheetApp.openById(ssId);
  }

  // Jika belum ada, buat Spreadsheet baru secara otomatis dan simpan ID-nya
  const created = SpreadsheetApp.create('Database Sistem Pengadaan Sembako');
  props.setProperty('SPREADSHEET_ID', created.getId());
  return created;
}

/**
 * Mengatur ID Spreadsheet secara manual untuk mode Standalone Web App.
 */
function setSpreadsheetId(spreadsheetId) {
  if (!spreadsheetId) throw new Error('ID Spreadsheet wajib diisi.');
  SpreadsheetApp.openById(spreadsheetId);
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheetId.trim());
  invalidateAllCache();
  return true;
}

/**
 * Menginisialisasi seluruh sheet dan header jika belum tersedia,
 * serta mengisi nilai bawaan pada sheet Pengaturan.
 */
function initDatabase() {
  const ss = getSpreadsheet();
  const now = formatDateTimeIso(new Date());
  const actor = getCurrentUserEmail() || 'system';

  Object.keys(SHEET_SCHEMAS).forEach((sheetName) => {
    let sheet = ss.getSheetByName(sheetName);
    const headers = SHEET_SCHEMAS[sheetName];
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f1f5f9');
      sheet.setFrozenRows(1);
    } else if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f1f5f9');
      sheet.setFrozenRows(1);
    }
  });

  // Hapus sheet bawaan "Sheet1" jika kosong dan sheet lain sudah dibuat
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() <= 1) {
    try {
      ss.deleteSheet(defaultSheet);
    } catch (e) {
      // Abaikan jika gagal menghapus Sheet1
    }
  }

  // Isi pengaturan default jika belum ada
  const settingsSheet = ss.getSheetByName(SHEET_NAMES.PENGATURAN);
  const existingRows = sheetToObjects(SHEET_NAMES.PENGATURAN, true);
  const existingKeys = new Set(existingRows.map((r) => String(r.key)));

  const defaults = [
    {
      key: 'default_minggu_jatuh_tempo',
      value: String(APP_CONFIG.DEFAULT_JATUH_TEMPO_MINGGU),
      keterangan: 'Default jatuh tempo order dalam minggu'
    },
    {
      key: 'allowed_emails',
      value: actor && actor !== 'system' ? actor : '',
      keterangan: 'Daftar email admin dipisah koma (kosong = hanya pemilik script)'
    },
    {
      key: 'staff_emails',
      value: '',
      keterangan: 'Daftar email staf dipisah koma (input order & setoran, tanpa hapus master)'
    },
    {
      key: 'backup_folder_id',
      value: '',
      keterangan: 'ID folder Google Drive untuk cadangan harian otomatis'
    },
    {
      key: 'nama_usaha',
      value: 'Pengadaan Sembako Lebaran',
      keterangan: 'Nama usaha yang tampil di aplikasi'
    }
  ];

  const rowsToInsert = [];
  defaults.forEach((item) => {
    if (!existingKeys.has(item.key)) {
      rowsToInsert.push([item.key, item.value, item.keterangan, actor, now, now]);
    }
  });

  if (rowsToInsert.length > 0) {
    settingsSheet.getRange(settingsSheet.getLastRow() + 1, 1, rowsToInsert.length, 6).setValues(rowsToInsert);
  }

  invalidateAllCache();
  return {
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl()
  };
}
