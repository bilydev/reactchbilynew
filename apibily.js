/* ============================================================
   apibily.js — SEMUA pemanggilan API react dari sisi browser ada di sini.
   Alurnya:
     1) Panggil /api/apibily (server Vercel, lihat api/apibily.js) -> hasil asli
        API terbaca, tidak kena CORS.
     2) Kalau /api/apibily tidak ada (404/405, mis. file api/ belum ter-deploy),
        pakai cadangan: panggil API langsung (mode no-cors). Request tetap
        terkirim, tapi balasannya tidak bisa dibaca browser.
   Mau ganti API / apikey? Ubah CONFIG di sini DAN di api/apibily.js.
   ============================================================ */
(function (global) {
  'use strict';

  /* ===== KONFIGURASI (dipakai untuk cadangan langsung) ===== */
  var CONFIG = {
    endpoint: 'https://api.izzxd.my.id/api/whatsapp/reactch-v2',
    apikey: 'bilyapiforyou',
    proxy: '/api/apibily',
    timeout: 60000 // ms — batas waktu menunggu balasan
  };

  /* API wajib menerima emoji dipisah koma: 😂,❤️,🔥  (bukan 😂❤️🔥).
     reaction boleh berupa array emoji atau string biasa. */
  function formatReaction(reaction) {
    var list;
    if (Array.isArray(reaction)) list = reaction;
    else {
      var str = String(reaction || '');
      list = (typeof Intl !== 'undefined' && Intl.Segmenter)
        ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str), function (x) { return x.segment; })
        : Array.from(str);
    }
    return list.map(function (x) { return String(x).trim(); })
               .filter(function (x) { return x && x !== ',' && !/^\s+$/.test(x); })
               .join(',');
  }

  /* Pesan error dibuat singkat: ambil kalimat pertama, maks 45 huruf. */
  function short(m) {
    m = String(m || '').replace(/[*_\u274C]/g, '').replace(/\s+/g, ' ').trim();
    var first = m.split(/(?<=[.!?])\s/)[0] || m;
    first = first.replace(/[.!]+$/, '');
    return first.length > 45 ? first.slice(0, 44).trim() + '…' : first;
  }

  function qs(link, reaction) {
    reaction = formatReaction(reaction);
    return '?url=' + encodeURIComponent(link) + '&reaction=' + encodeURIComponent(reaction);
  }
  function directUrl(link, reaction) {
    return CONFIG.endpoint + qs(link, reaction) + '&apikey=' + encodeURIComponent(CONFIG.apikey);
  }

  /*
    Kirim react. Selalu resolve (tidak pernah throw):
      { ok, outcome: 'success'|'sent'|'failed', msg }
    'sent' = request sudah terkirim tapi balasannya tidak bisa dibaca (jalur cadangan).
  */
  async function send(link, reaction) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, CONFIG.timeout);
    try {
      var res = null;
      try {
        res = await fetch(CONFIG.proxy + qs(link, reaction), { signal: ctrl.signal, cache: 'no-store' });
      } catch (err) {
        if (err && err.name === 'AbortError') return { ok: false, outcome: 'failed', msg: 'server lama membalas' };
        if (!navigator.onLine) return { ok: false, outcome: 'failed', msg: 'koneksi terputus' };
        return { ok: false, outcome: 'failed', msg: 'server tidak terhubung' };
      }

      // /api/apibily belum ada -> jalur cadangan (langsung ke API)
      if (res.status === 404 || res.status === 405) {
        try {
          await fetch(directUrl(link, reaction), { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
          return { ok: true, outcome: 'sent', msg: '' };
        } catch (err) {
          if (err && err.name === 'AbortError') return { ok: false, outcome: 'failed', msg: 'server lama membalas' };
          return { ok: false, outcome: 'failed', msg: navigator.onLine ? 'API tidak terhubung' : 'koneksi terputus' };
        }
      }

      var j = null;
      try { j = await res.json(); } catch (_) {}
      if (!j) return { ok: false, outcome: 'failed', msg: 'balasan tidak dikenali' };
      if (j.ok) return { ok: true, outcome: 'success', msg: '' };
      return { ok: false, outcome: 'failed', msg: short(j.message || 'API menolak') };
    } finally {
      clearTimeout(timer);
    }
  }

  global.ApiBily = { config: CONFIG, send: send, formatReaction: formatReaction };
})(window);
