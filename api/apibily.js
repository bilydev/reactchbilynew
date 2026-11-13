/* ============================================================
   api/apibily.js — jembatan (proxy) di server Vercel.
   Browser memanggil /api/apibily, lalu file ini yang memanggil API react.
   Kenapa perlu: API react tidak mengizinkan dipanggil langsung dari browser
   (diblokir CORS), jadi hasilnya tidak bisa dibaca dan terlihat "tidak work".
   Dari server tidak ada masalah CORS, dan balasan asli API bisa ditampilkan.

   Mau ganti API / apikey? Ubah CONFIG di bawah (atau isi Environment Variable
   BILY_API_KEY di Vercel). Jangan lupa samakan juga dengan CONFIG di /apibily.js
   (dipakai hanya sebagai cadangan kalau file ini tidak ikut ter-deploy).
   ============================================================ */
const CONFIG = {
  endpoint: 'https://api.izzxd.my.id/api/whatsapp/reactch-v2',
  apikey: process.env.BILY_API_KEY || 'bilyapiforyou',
  timeout: 50000 // ms
};

function reply(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  let q = req.query || {};
  if (req.method === 'POST' && req.body) {
    try { q = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch (_) {}
  }
  const link = String(q.url || '').trim();
  const reaction = String(q.reaction || '').trim();

  if (!/^https?:\/\/(www\.)?whatsapp\.com\/channel\//i.test(link) || link.length > 2048)
    return reply(res, 400, { ok: false, message: 'link saluran tidak valid' });
  if (!reaction || reaction.length > 120)
    return reply(res, 400, { ok: false, message: 'emoji tidak valid' });

  const target = CONFIG.endpoint +
    '?url=' + encodeURIComponent(link) +
    '&reaction=' + encodeURIComponent(reaction) +
    '&apikey=' + encodeURIComponent(CONFIG.apikey);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.timeout);
  try {
    const up = await fetch(target, {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0 (compatible; BilyReaction/1.0)' }
    });
    if (up.status === 429) return reply(res, 200, { ok: false, upstreamStatus: 429, message: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.' });
    const text = await up.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    let ok = up.ok, message = '';
    if (data && typeof data === 'object') {
      if (data.status === false || data.success === false || data.ok === false ||
          (typeof data.status === 'number' && data.status >= 400) || data.error) ok = false;
      message = String(data.message || data.error || data.msg || data.result || '');
    } else {
      message = text.slice(0, 200);
    }
    message = message.replace(/[*_]/g, '').replace(/\u274C/g, '').replace(/\s+/g, ' ').trim();
    if (!ok && !message) message = 'API membalas kode ' + up.status;
    return reply(res, 200, { ok, upstreamStatus: up.status, message, data: data || undefined });
  } catch (err) {
    const timeout = err && err.name === 'AbortError';
    return reply(res, 502, { ok: false, message: timeout ? 'server lama membalas' : 'API tidak terhubung' });
  } finally {
    clearTimeout(timer);
  }
};
