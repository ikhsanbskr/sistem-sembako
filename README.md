# Sistem Sembako (Google Apps Script)

A lightweight web application built with **Google Apps Script (GAS)** and **Google Sheets** to manage installment-based grocery (*sembako*) orders ahead of Eid, track weekly payment progress and remaining balances, and aggregate supplier procurement needs.

## Key Features

- **Dashboard**: Real-time summary cards (active orders, total payments received, remaining balance, fully paid customers), weekly/monthly collections, overdue/behind-schedule customer alerts, upcoming due dates, and top remaining balances.
- **Customer Management**: Create, update, search, and deactivate customers, including inline quick-add directly from the order form and a detailed view with cumulative payment history.
- **Products & Packages**: Manage master products (code, name, unit) and grocery packages composed of multiple products with **weekly package pricing**.
- **Order Processing**:
  - Supports package and product line items with price snapshots at transaction time.
  - Optional discount and shipping fee calculation.
  - Flexible due-date configuration: default **46 weeks** (configurable in Settings) or pick a specific target date with automatic week calculation.
  - Automatic sequential order numbering (`ORD-YYYY-XXXX`) and weekly installment target calculation.
- **Installment Payments (*Setoran*)**:
  - Validates payment amounts against the remaining balance.
  - Automatically marks orders as **Lunas** (Paid Off) once the remaining balance reaches zero.
  - Concurrency-safe numbering (`STR-YYYY-XXXX`) via `LockService` and duplicate-submission protection via idempotency keys (`CacheService`).
- **Goods Handover (*Penyerahan*)**: Track ready-to-deliver paid orders, flag unpaid orders nearing due dates for admin review, and record delivery date, recipient, and notes.
- **Reports & Procurement Summary (*Rekapan*)**:
  - Filterable by date range, customer, order status, and period grouping (daily/weekly/monthly).
  - **Procurement Needs Breakdown**: Automatically unpacks ordered packages into total product quantities for supplier purchasing.
  - Export reports to **CSV**, a new **Google Sheets** file, or **Print/PDF**.
- **Access Control & Automated Backups**: Email-based role permissions (`Admin` and `Staff`) and one-click or daily scheduled Google Drive spreadsheet backups.

## Tech Stack

- **Backend**: Google Apps Script (V8 Runtime), `SpreadsheetApp`, `LockService`, `CacheService`, `DriveApp`, `PropertiesService`
- **Database**: Google Sheets (batch read/write with audit columns: `dibuat_oleh`, `dibuat_pada`, `diubah_pada`)
- **Frontend**: `HtmlService` (responsive vanilla HTML/CSS/JS SPA)

## Deployment Guide

### Option A: Container-Bound (Google Sheets)
1. Create a new Google Sheets spreadsheet in your Google Drive.
2. Open **Extensions → Apps Script**.
3. Copy the `.gs`, `.html`, and `appsscript.json` files into the Apps Script editor.
4. Run the `initDatabase` function once from `Config.gs` to generate all required sheets and headers.
5. Click **Deploy → New deployment → Web app**:
   - **Execute as**: `Me`
   - **Who has access**: `Anyone` (or `Anyone with Google account` for Google Workspace/single-account environments)

### Option B: Using `clasp`
1. Authenticate: `clasp login`
2. Create a project: `clasp create --title "Sistem Pengadaan Sembako" --type webapp`
3. Push source files: `clasp push`
4. Deploy: `clasp deploy`

> **Standalone Mode Note**: On first launch, `initDatabase()` automatically creates a new Google Sheets database in your Drive and stores its ID in Script Properties (`SPREADSHEET_ID`). To link an existing spreadsheet, run `setSpreadsheetId('YOUR_SPREADSHEET_ID')` from the Apps Script editor.
