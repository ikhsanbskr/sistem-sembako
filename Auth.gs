/**
 * Kontrol akses pengguna berdasarkan daftar email di sheet Pengaturan.
 * Admin: akses penuh.
 * Staf: input pesanan dan setoran, tanpa hapus/nonaktifkan master atau ubah pengaturan.
 */

function getEffectiveOwnerEmail() {
  try {
    return (Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

function parseEmailList(raw) {
  return String(raw || '')
    .split(/[,;\n]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function getUserContext() {
  const email = getCurrentUserEmail();
  const ownerEmail = getEffectiveOwnerEmail();
  const adminEmails = parseEmailList(getSettingValue('allowed_emails', ''));
  const staffEmails = parseEmailList(getSettingValue('staff_emails', ''));

  // Pemilik script selalu memiliki akses admin jika daftar admin kosong atau jika email cocok
  if (email && ownerEmail && email === ownerEmail) {
    return { authorized: true, email: email, role: APP_CONFIG.USER_ROLE.ADMIN };
  }

  if (email && adminEmails.includes(email)) {
    return { authorized: true, email: email, role: APP_CONFIG.USER_ROLE.ADMIN };
  }

  if (email && staffEmails.includes(email)) {
    return { authorized: true, email: email, role: APP_CONFIG.USER_ROLE.STAF };
  }

  // Fallback jika Web App dijalankan tanpa info email dan daftar email masih kosong
  if (!email && adminEmails.length === 0 && staffEmails.length === 0) {
    return { authorized: true, email: ownerEmail || 'admin', role: APP_CONFIG.USER_ROLE.ADMIN };
  }

  return { authorized: false, email: email || 'tidak diketahui', role: null };
}

function requireAuth(requiredRole) {
  const ctx = getUserContext();
  if (!ctx.authorized) {
    throw new Error('Akses ditolak. Email Anda (' + ctx.email + ') belum terdaftar di Pengaturan.');
  }
  if (requiredRole === APP_CONFIG.USER_ROLE.ADMIN && ctx.role !== APP_CONFIG.USER_ROLE.ADMIN) {
    throw new Error('Akses ditolak. Tindakan ini hanya diizinkan untuk Admin.');
  }
  return ctx;
}
