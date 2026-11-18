# Aplikasi Pengadaan Sembako (Google Apps Script)

Aplikasi web berbasis **Google Apps Script (GAS)** dan **Google Sheets** untuk mencatat pesanan paket/barang sembako dengan pembayaran setoran bertahap (default 46 minggu), memantau progres dan sisa setoran, serta merekap kebutuhan belanja pengadaan.

## Struktur Berkas

- `appsscript.json` — Konfigurasi manifest GAS (V8 runtime, zona waktu `Asia/Jakarta`, *scopes*).
- `Config.gs` — Konstanta aplikasi, skema 8 sheet (`Customer`, `Produk`, `Paket`, `Paket_Item`, `Order`, `Order_Item`, `Setoran`, `Pengaturan`), dan inisialisasi database (`initDatabase`).
- `Auth.gs` — Otorisasi berbasis email Google (`Admin` & `Staf`).
- `Utils.gs` — Utilitas `LockService`, `CacheService`, pembacaan/penulisan batch, dan penomoran otomatis (`ORD-YYYY-0001`, `STR-YYYY-0001`).
- `CustomerService.gs` — CRUD Customer dan ringkasan riwayat order/setoran customer.
- `CatalogService.gs` — CRUD Produk dan Paket Sembako beserta komposisi `Paket_Item`.
- `OrderService.gs` — Pembuatan order, harga *snapshot*, perhitungan target mingguan & progres jadwal, pembatalan/hapus, dan penyerahan barang.
- `SetoranService.gs` — Pencatatan setoran dengan validasi sisa setoran dan pembaruan status **Lunas** otomatis.
- `DashboardReportService.gs` — Data Dashboard, Rekapan (Kebutuhan Barang, Per Customer, Per Periode, Per Produk/Paket), ekspor Google Sheets/CSV, dan *backup* harian ke Drive.
- `Code.gs` — `doGet()` dan *endpoint* API untuk antarmuka web.
- `Index.html`, `Styles.html`, `Scripts.html` — Antarmuka web responsif (*HtmlService*).

## Cara Deploy

### Opsi A: Langsung dari Google Sheets (Container-bound, Paling Mudah)
1. Buat Google Sheets baru di Google Drive Anda.
2. Buka menu **Ekstensi (Extensions) → Apps Script**.
3. Salin isi seluruh berkas `.gs` dan `.html` di folder ini ke proyek Apps Script (samakan nama berkasnya, tanpa ekstensi di editor GAS).
4. Aktifkan tampilan `appsscript.json` di *Project Settings* lalu salin isi `appsscript.json`.
5. Jalankan fungsi `initDatabase` sekali dari editor untuk membuat seluruh sheet dan header otomatis.
6. Klik **Deploy → New deployment → Web app**:
   - *Execute as*: **Me (User deploying)**
   - *Who has access*: **Anyone** (atau **Anyone with Google account** agar email pengguna terbaca untuk otorisasi di `Pengaturan`).

### Opsi B: Menggunakan `clasp` (Standalone / Bound)
1. Login: `clasp login`
2. Buat proyek baru: `clasp create --title "Sistem Pengadaan Sembako" --type webapp` (atau `--type sheets` jika ingin terikat ke Google Sheets).
3. Unggah kode: `clasp push`
4. Deploy: `clasp deploy`

> **Catatan Mode Standalone**: Saat pertama kali dibuka, `initDatabase()` akan otomatis membuat file Google Sheets baru di Drive Anda dan menyimpan ID-nya di *Script Properties* (`SPREADSHEET_ID`). Jika ingin menghubungkan ke Spreadsheet yang sudah ada, jalankan `setSpreadsheetId('ID_SPREADSHEET_ANDA')` di editor GAS.
