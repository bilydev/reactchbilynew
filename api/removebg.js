/* ============================================================
   api/removebg.js — jembatan same-origin ke Nexray Remove BG.
   Alur halaman: foto -> /api/tourl (jadi link) -> /api/removebg?url=<link> -> gambar tanpa background.

   Balasan:
     - Jika Nexray membalas gambar langsung  -> gambar di-stream apa adanya (image/png dll).
     - Jika Nexray membalas JSON berisi link -> { ok:true, url, sig? }  (sig dipakai /api/dlfile untuk unduhan).
     - Jika gagal                            -> { ok:false, message } dengan kode HTTP error.
   ============================================================ */
const crypto = require('crypto');
const net = require('net');
const { Readable, Transform, pipeline } = require('stream');

const ENDPOINT = 'https://api.nexray.eu.cc/tools/removebg';
const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT = 50000;

/* rate limit per IP — in-memory per instance, jadi best-effort */
const hits = new Map();
function limited(req, max, windowMs) {
  const h = req.headers || {};
  const ip = String(h['cf-connecting-ip'] || h['x-vercel-forwarded-for'] || h['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'x').split(',')[0].trim();
  const now = Date.now();
  let e = hits.get(ip);
  if (!e || now - e.t > windowMs) { e = { t: now, n: 0 }; hits.set(ip, e); }
  e.n++;
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.t > windowMs) hits.delete(k);
  return e.n > max;
}

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function publicHttpUrl(value) {
  let u;
  try { u = new URL(String(value || '').trim()); } catch (_) { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || net.isIP(host)) return null;
  return u;
}

function findUrl(data, depth = 0) {
  if (depth > 5 || data == null) return '';
  if (typeof data === 'string') { const u = publicHttpUrl(data); return u ? u.href : ''; }
  if (typeof data !== 'object') return '';
  for (const key of ['url', 'result', 'data', 'image', 'output', 'file', 'link']) {
    const url = findUrl(data[key], depth + 1);
    if (url) return url;
  }
  return '';
}

function sign(url) {
  const secret = process.env.DL_SECRET;
  if (!secret) return undefined;
  const exp = String(Math.floor(Date.now() / 1000) + 30 * 60);
  return exp + '.' + crypto.createHmac('sha256', secret).update(exp + '|' + url).digest('hex');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { ok: false, message: 'Metode tidak didukung.' });
  }
  if (limited(req, 15, 60000)) { res.setHeader('Retry-After', '30'); return json(res, 429, { ok: false, message: 'Terlalu banyak permintaan. Coba lagi nanti.' }); }

  const input = typeof (req.query || {}).url === 'string' ? req.query.url.trim() : '';
  const source = input.length <= 2048 ? publicHttpUrl(input) : null;
  if (!source) return json(res, 400, { ok: false, message: 'Link gambar tidak valid.' });

  const target = new URL(ENDPOINT);
  target.searchParams.set('url', source.href);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  try {
    const up = await fetch(target.toString(), { signal: ctrl.signal, headers: { Accept: 'image/*, application/json, */*', 'User-Agent': 'Mozilla/5.0 (compatible; BilyReaction/1.0)' } });
    const type = String(up.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();

    if (up.status === 429) return json(res, 429, { ok: false, message: 'Terlalu banyak permintaan. Coba lagi nanti.' });

    // Balasan JSON / teks: error atau link hasil.
    if (!type.startsWith('image/') && (type.includes('json') || type.startsWith('text/') || !up.ok)) {
      const text = (await up.text()).slice(0, 2 * 1024 * 1024);
      let data = null; try { data = JSON.parse(text); } catch (_) {}
      const failed = !up.ok || (data && typeof data === 'object' && (data.status === false || data.success === false || data.ok === false || data.error || (typeof data.status === 'number' && data.status >= 400)));
      if (failed) {
        const v = data && typeof data === 'object' ? (data.message || data.msg || data.error) : '';
        const message = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
        return json(res, 502, { ok: false, message: message || ('API Remove BG membalas kode ' + up.status + '.') });
      }
      const url = findUrl(data !== null ? data : text);
      if (!url) return json(res, 502, { ok: false, message: 'API tidak mengembalikan gambar yang valid.' });
      return json(res, 200, { ok: true, url, sig: sign(url) });
    }

    // Balasan gambar langsung: alirkan (streaming) supaya tidak kena batas 4,5 MB respons Vercel.
    if (!up.body) return json(res, 502, { ok: false, message: 'Gambar dari API kosong.' });
    const length = Number(up.headers.get('content-length')) || 0;
    if (length > MAX_BYTES) return json(res, 502, { ok: false, message: 'Hasil gambar terlalu besar.' });
    res.statusCode = 200;
    res.setHeader('Content-Type', type.startsWith('image/') ? type : 'image/png');
    if (length) res.setHeader('Content-Length', String(length));
    let sent = 0;
    const limiter = new Transform({ transform(chunk, _e, cb) { sent += chunk.length; sent > MAX_BYTES ? cb(new Error('too-large')) : cb(null, chunk); } });
    pipeline(Readable.fromWeb(up.body), limiter, res, () => { clearTimeout(timer); ctrl.abort(); });
    return;
  } catch (error) {
    clearTimeout(timer);
    if (res.headersSent) { try { res.destroy(); } catch (_) {} return; }
    return json(res, 502, { ok: false, message: error.name === 'AbortError' ? 'API terlalu lama merespons. Coba lagi.' : 'API Remove BG tidak dapat dihubungi. Coba lagi nanti.' });
  } finally {
    if (res.writableEnded) clearTimeout(timer);
  }
};
