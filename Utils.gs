/**
 * Utilitas umum: LockService, CacheService, baca/tulis batch, penomoran otomatis, dan format tanggal.
 */

function getCurrentUserEmail() {
  try {
    return (Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Menjalankan operasi tulis di dalam LockService sekaligus mencegah duplikasi
 * apabila request_id yang sama dikirim ulang dalam rentang 120 detik.
 */
function withIdempotentLock(requestId, fn) {
  return withLock(() => {
    if (requestId) {
      const cache = CacheService.getScriptCache();
      const key = 'IDEMP_' + String(requestId);
      const cached = cache.get(key);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch (e) {
          // Lanjut eksekusi jika cache rusak
        }
      }
      const result = fn();
      try {
        cache.put(key, JSON.stringify(result), 120);
      } catch (e) {
        // Abaikan jika payload terlalu besar untuk cache
      }
      return result;
    }
    return fn();
  });
}

function getCacheKey(sheetName) {
  return 'SHEET_DATA_' + sheetName;
}

function invalidateCache(sheetNames) {
  const cache = CacheService.getScriptCache();
  const list = Array.isArray(sheetNames) ? sheetNames : [sheetNames];
  cache.removeAll(list.map(getCacheKey));
}

function invalidateAllCache() {
  invalidateCache(Object.values(SHEET_NAMES));
}

/**
 * Membaca seluruh baris dari sebuah sheet secara batch (getValues) dan mengonversinya menjadi array objek.
 * Menggunakan CacheService untuk mempercepat pembacaan berulang.
 */
function sheetToObjects(sheetName, skipCache) {
  const cache = CacheService.getScriptCache();
  const key = getCacheKey(sheetName);

  if (!skipCache) {
    const cached = cache.get(key);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        // Lanjut baca ulang dari sheet jika JSON rusak
      }
    }
  }

  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) return [];

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map((h) => String(h).trim());
  const rows = [];

  for (let i = 1; i < values.length; i++) {
    const rowArr = values[i];
    const isEmpty = rowArr.every((cell) => cell === '' || cell === null || cell === undefined);
    if (isEmpty) continue;

    const obj = { _rowIndex: i + 1 };
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (!header) continue;
      let val = rowArr[j];
      if (val instanceof Date) {
        val = formatDateIso(val);
      }
      obj[header] = val;
    }
    rows.push(obj);
  }

  // Simpan ke cache jika ukurannya aman (< 90 KB agar tidak melebihi batas 100 KB CacheService)
  try {
    const serialized = JSON.stringify(rows);
    if (serialized.length < 90000) {
      cache.put(key, serialized, APP_CONFIG.CACHE_TTL_SECONDS);
    }
  } catch (e) {
    // Abaikan jika ukuran melebihi batas cache
  }

  return rows;
}

/**
 * Menambahkan 1 atau banyak objek ke sheet sesuai urutan schema.
 */
function appendObjects(sheetName, items) {
  if (!items || items.length === 0) return;
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet tidak ditemukan: ' + sheetName);

  const schema = SHEET_SCHEMAS[sheetName];
  const now = formatDateTimeIso(new Date());
  const actor = getCurrentUserEmail() || 'system';

  const matrix = items.map((item) => {
    const record = Object.assign({}, item, {
      dibuat_oleh: item.dibuat_oleh || actor,
      dibuat_pada: item.dibuat_pada || now,
      diubah_pada: item.diubah_pada || now
    });
    return schema.map((col) => (record[col] !== undefined ? record[col] : ''));
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, matrix.length, schema.length).setValues(matrix);
  invalidateCache(sheetName);
}

/**
 * Memperbarui satu baris berdasarkan nilai kolom `id` (atau kolom kunci lain).
 */
function updateObjectByKey(sheetName, keyCol, keyVal, patch) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet tidak ditemukan: ' + sheetName);

  const schema = SHEET_SCHEMAS[sheetName];
  const rows = sheetToObjects(sheetName, true);
  const target = rows.find((r) => String(r[keyCol]) === String(keyVal));
  if (!target) throw new Error('Data tidak ditemukan di ' + sheetName + ' (' + keyCol + '=' + keyVal + ')');

  const now = formatDateTimeIso(new Date());
  const updated = Object.assign({}, target, patch, { diubah_pada: now });
  const rowValues = schema.map((col) => (updated[col] !== undefined ? updated[col] : ''));

  sheet.getRange(target._rowIndex, 1, 1, schema.length).setValues([rowValues]);
  invalidateCache(sheetName);
  return updated;
}

/**
 * Menghapus baris-baris yang cocok dengan kondisi keyCol === keyVal (dari bawah ke atas).
 */
function deleteObjectsByKey(sheetName, keyCol, keyVal) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return 0;

  const rows = sheetToObjects(sheetName, true);
  const matches = rows.filter((r) => String(r[keyCol]) === String(keyVal)).sort((a, b) => b._rowIndex - a._rowIndex);
  matches.forEach((m) => sheet.deleteRow(m._rowIndex));
  if (matches.length > 0) invalidateCache(sheetName);
  return matches.length;
}

function generateId(prefix) {
  return (prefix || 'ID') + '-' + Utilities.getUuid().slice(0, 8).toUpperCase();
}

/**
 * Menghasilkan nomor berurutan seperti ORD-2026-0001 atau STR-2026-0001.
 */
function generateSequentialNumber(sheetName, columnName, prefix, dateStr) {
  const year = (dateStr ? String(dateStr).slice(0, 4) : String(new Date().getFullYear()));
  const fullPrefix = prefix + '-' + year + '-';
  const rows = sheetToObjects(sheetName, true);

  let maxSeq = 0;
  rows.forEach((r) => {
    const val = String(r[columnName] || '');
    if (val.startsWith(fullPrefix)) {
      const seq = parseInt(val.slice(fullPrefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  });

  const next = String(maxSeq + 1).padStart(4, '0');
  return fullPrefix + next;
}

function toNumber(val, fallback) {
  if (val === '' || val === null || val === undefined) return fallback || 0;
  const num = Number(val);
  return isNaN(num) ? (fallback || 0) : num;
}

function toBoolean(val, defaultVal) {
  if (typeof val === 'boolean') return val;
  if (val === '' || val === null || val === undefined) return defaultVal !== undefined ? defaultVal : true;
  const s = String(val).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'ya' || s === 'aktif';
}

function formatDateIso(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function formatDateTimeIso(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, APP_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function addDaysIso(dateStr, days) {
  const parts = String(dateStr).split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + days);
  return formatDateIso(d);
}

function diffDaysIso(fromDateStr, toDateStr) {
  const p1 = String(fromDateStr).split('-').map(Number);
  const p2 = String(toDateStr).split('-').map(Number);
  const d1 = new Date(p1[0], p1[1] - 1, p1[2]);
  const d2 = new Date(p2[0], p2[1] - 1, p2[2]);
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function getSettingValue(key, defaultValue) {
  const settings = sheetToObjects(SHEET_NAMES.PENGATURAN);
  const found = settings.find((s) => String(s.key) === String(key));
  if (!found || found.value === '' || found.value === null || found.value === undefined) {
    return defaultValue;
  }
  return String(found.value);
}
