/* ============================================================
   apibily.js — SEMUA pemanggilan API react ada di file ini.
   Mau ganti API / apikey / nama endpoint? Cukup ubah bagian
   KONFIGURASI di bawah, index.html tidak perlu disentuh.
   ============================================================ */
(function (global) {
  'use strict';

  /* ===== KONFIGURASI (ubah di sini) ===== */
  var CONFIG = {
    endpoint: 'https://api.izzxd.my.id/api/whatsapp/reactch-v2',
    apikey: 'bilyapiforyou',
    timeout: 60000 // ms — batas waktu menunggu balasan server
  };

  /* Susun URL lengkap: ?url=<link channel>&reaction=<emoji>&apikey=<key> */
  function buildUrl(link, reaction) {
    return CONFIG.endpoint +
      '?url=' + encodeURIComponent(link) +
      '&reaction=' + encodeURIComponent(reaction) +
      '&apikey=' + encodeURIComponent(CONFIG.apikey);
  }

  /*
    Kirim react. Selalu resolve (tidak pernah throw) dengan bentuk:
      { ok: true|false, outcome: 'success'|'failed'|'unconfirmed', msg: '...' }
  */
  async function send(link, reaction) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, CONFIG.timeout);
    var ok = true, msg = '', outcome = 'success';
    try {
      var res = await fetch(buildUrl(link, reaction), { signal: ctrl.signal }); // tunggu server selesai membalas
      if (!res.ok) {
        ok = false; outcome = 'failed'; msg = 'server menolak (kode ' + res.status + ')';
      } else {
        try {
          var j = await res.clone().json();
          if (j && (j.status === false || j.success === false || j.ok === false)) {
            ok = false; outcome = 'failed';
            msg = String(j.message || j.error || 'server menolak permintaan');
          }
        } catch (_) { /* balasan bukan JSON — anggap sukses */ }
      }
    } catch (err) {
      if (err && err.name === 'AbortError') { ok = false; msg = 'server terlalu lama membalas'; }
      else if (!navigator.onLine) { ok = false; msg = 'koneksi terputus'; }
      else { ok = false; msg = 'hasil tidak dapat dipastikan (koneksi atau CORS)'; console.warn('Balasan API tidak bisa dibaca:', err); }
    }
    clearTimeout(timer);
    if (!ok && outcome !== 'failed') outcome = 'unconfirmed';
    return { ok: ok, outcome: outcome, msg: msg };
  }

  global.ApiBily = { config: CONFIG, buildUrl: buildUrl, send: send };
})(window);
