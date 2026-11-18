/**
 * Entry point Google Apps Script Web App & API wrapper untuk google.script.run.
 */

function doGet() {
  try {
    initDatabase();
  } catch (e) {
    // Abaikan jika init sudah berjalan
  }

  const template = HtmlService.createTemplateFromFile('Index');
  template.appName = getSettingValue('nama_usaha', APP_CONFIG.APP_NAME);

  return template
    .evaluate()
    .setTitle(APP_CONFIG.APP_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function safeExecute(fn) {
  try {
    return { ok: true, data: fn() };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function apiBootstrap() {
  return safeExecute(() => {
    initDatabase();
    const auth = requireAuth();
    return {
      user: auth,
      appName: getSettingValue('nama_usaha', APP_CONFIG.APP_NAME),
      defaultMinggu: toNumber(
        getSettingValue('default_minggu_jatuh_tempo', APP_CONFIG.DEFAULT_JATUH_TEMPO_MINGGU),
        APP_CONFIG.DEFAULT_JATUH_TEMPO_MINGGU
      ),
      dashboard: getDashboardData(),
      customers: getCustomers(false),
      products: getProducts(false),
      packages: getPackages(false)
    };
  });
}

function apiGetDashboard() {
  return safeExecute(() => getDashboardData());
}

function apiGetCustomers(includeInactive) {
  return safeExecute(() => getCustomers(includeInactive));
}

function apiGetCustomerDetail(customerId) {
  return safeExecute(() => getCustomerDetail(customerId));
}

function apiSaveCustomer(payload) {
  return safeExecute(() => saveCustomer(payload));
}

function apiToggleCustomerStatus(customerId, aktif) {
  return safeExecute(() => toggleCustomerStatus(customerId, aktif));
}

function apiGetProducts(includeInactive) {
  return safeExecute(() => getProducts(includeInactive));
}

function apiSaveProduct(payload) {
  return safeExecute(() => saveProduct(payload));
}

function apiToggleProductStatus(productId, aktif) {
  return safeExecute(() => toggleProductStatus(productId, aktif));
}

function apiGetPackages(includeInactive) {
  return safeExecute(() => getPackages(includeInactive));
}

function apiSavePackage(payload) {
  return safeExecute(() => savePackage(payload));
}

function apiTogglePackageStatus(paketId, aktif) {
  return safeExecute(() => togglePackageStatus(paketId, aktif));
}

function apiGetOrders(filters) {
  return safeExecute(() => getOrders(filters));
}

function apiGetOrderDetail(orderId) {
  return safeExecute(() => getOrderDetail(orderId));
}

function apiCreateOrder(payload) {
  return safeExecute(() => createOrder(payload));
}

function apiCancelOrder(orderId, forceConfirm) {
  return safeExecute(() => cancelOrder(orderId, forceConfirm));
}

function apiDeleteOrder(orderId) {
  return safeExecute(() => deleteOrder(orderId));
}

function apiDeliverOrder(payload) {
  return safeExecute(() => deliverOrder(payload));
}

function apiGetSetoranList(filters) {
  return safeExecute(() => getSetoranList(filters));
}

function apiCreateSetoran(payload) {
  return safeExecute(() => createSetoran(payload));
}

function apiGetRekapan(filters) {
  return safeExecute(() => getRekapanData(filters));
}

function apiExportRekapanToSheet(filters) {
  return safeExecute(() => exportRekapanToSheet(filters));
}

function apiGetRekapanCsv(type, filters) {
  return safeExecute(() => getRekapanCsv(type, filters));
}

function apiGetSettings() {
  return safeExecute(() => getSettings());
}

function apiSaveSettings(entries) {
  return safeExecute(() => saveSettings(entries));
}

function apiRunBackupNow() {
  return safeExecute(() => {
    requireAuth(APP_CONFIG.USER_ROLE.ADMIN);
    return runDailyBackup();
  });
}

function apiSetupDailyBackupTrigger() {
  return safeExecute(() => setupDailyBackupTrigger());
}
