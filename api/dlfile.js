/* ============================================================
   api/dlfile.js — proxy unduhan same-origin untuk Downloader All Link.
   Kenapa perlu: CDN media hampir tidak pernah mengizinkan CORS, jadi fetch()
   dari browser gagal. Di sini server mengambil file dan mengirimnya ke browser
   dengan "Content-Disposition: attachment", sehingga browser menjalankan unduhan
   sendiri di latar belakang (muncul di daftar download / folder Download),
   tanpa membuka tab dan tanpa menyimpan file di memori halaman.

   Mode:
     GET /api/dlfile?url=...&name=...&sig=...            -> stream file (unduhan)
     GET /api/dlfile?url=...&name=...&sig=...&check=1    -> JSON {ok,size,type} (cek cepat)

   Keamanan:
     - sig (HMAC) dari /api/downloader dipakai kalau Environment Variable DL_SECRET diisi.
       Isi DL_SECRET di Vercel supaya proxy hanya mau mengunduh link yang berasal
       dari hasil API (bukan proxy terbuka).
     - Host privat/localhost/metadata ditolak, port selain 80/443 ditolak, redirect divalidasi ulang.
     - Respons HTML/JSON/playlist ditolak, ukuran dibatasi, ada rate limit per IP (best-effort).
   ============================================================ */
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { Readable, Transform, pipeline } = require('stream');

const MAX_BYTES = 300 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const CONNECT_TIMEOUT = 20000;
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const TEST_MODE = process.env.DL_ALLOW_PRIVATE === '1'; // hanya untuk pengujian lokal

/* rate limit per IP — in-memory per instance, jadi sifatnya best-effort */
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

function verifySig(url, sig) {
  const secret = process.env.DL_SECRET;
  if (!secret) return true; // tanpa secret: hanya mengandalkan penjagaan SSRF
  const m = /^(\d{10,})\.([a-f0-9]{64})$/.exec(String(sig || ''));
  if (!m || Number(m[1]) < Math.floor(Date.now() / 1000)) return false;
  const want = crypto.createHmac('sha256', secret).update(m[1] + '|' + url).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2]));
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::' || l === '::1' || l.startsWith('::ffff:') || /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
  }
  return true;
}

async function assertPublic(u) {
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Link media tidak valid.');
  if (TEST_MODE) return;
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('Link media tidak diizinkan.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost'))
    throw new Error('Link media tidak diizinkan.');
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('Link media tidak diizinkan.'); return; }
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); } catch (_) { throw new Error('Server media tidak ditemukan.'); }
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('Link media tidak diizinkan.');
}

function cleanName(name, fallbackExt) {
  let n = String(name || '').normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[.\-]+/, '').slice(0, 80);
  const m = /\.(mp4|mp3)$/i.exec(n);
  if (!m) n = (n.replace(/\.+$/, '') || 'bily-media') + '.' + fallbackExt;
  return n;
}

/* ikuti redirect secara manual agar tiap tujuan divalidasi ulang */
async function open(startUrl, headers, ctrl) {
  let current = startUrl;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertPublic(current);
    const up = await fetch(current.toString(), { headers, redirect: 'manual', signal: ctrl.signal });
    if (up.status >= 300 && up.status < 400 && up.headers.get('location')) {
      try { current = new URL(up.headers.get('location'), current); } catch (_) { throw new Error('Redirect media tidak valid.'); }
      try { await up.body.cancel(); } catch (_) {}
      continue;
    }
    return up;
  }
  throw new Error('Terlalu banyak redirect.');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return json(res, 405, { ok: false, message: 'Metode tidak didukung.' });
  }
  if (limited(req, 30, 60000)) { res.setHeader('Retry-After', '30'); return json(res, 429, { ok: false, message: 'Terlalu banyak permintaan. Coba lagi nanti.' }); }

  const q = req.query || {};
  const raw = typeof q.url === 'string' ? q.url.trim() : '';
  const check = q.check === '1';
  let target;
  try { target = new URL(raw); } catch (_) {}
  if (!target || raw.length > 4096) return json(res, 400, { ok: false, message: 'Link media tidak valid.' });
  if (!verifySig(raw, q.sig)) return json(res, 403, { ok: false, message: 'Link unduhan kedaluwarsa. Cari media lagi.' });

  const ctrl = new AbortController();
  let connectTimer = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT);
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });

  try {
    const headers = { 'User-Agent': UA, Accept: '*/*', 'Accept-Encoding': 'identity' };
    if (check) headers.Range = 'bytes=0-0';
    else if (typeof req.headers.range === 'string' && /^bytes=\d*-\d*$/.test(req.headers.range)) headers.Range = req.headers.range;

    const up = await open(target, headers, ctrl);
    clearTimeout(connectTimer); connectTimer = null;

    if (up.status === 429) { ctrl.abort(); return json(res, 429, { ok: false, message: 'Server media membatasi permintaan. Coba lagi nanti.' }); }
    if (up.status !== 200 && up.status !== 206) { ctrl.abort(); return json(res, 502, { ok: false, message: 'Server media membalas kode ' + up.status + '.' }); }

    const type = String(up.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    if (/^(text\/|application\/json|application\/(x-mpegurl|vnd\.apple\.mpegurl)|application\/xml)/.test(type)) {
      ctrl.abort(); return json(res, 502, { ok: false, message: 'Server tidak mengirim file media.' });
    }
    const range = /\/(\d+)$/.exec(up.headers.get('content-range') || '');
    const length = Number(up.headers.get('content-length')) || 0;
    const total = range ? Number(range[1]) : (up.status === 200 ? length : 0);
    if (total > MAX_BYTES) { ctrl.abort(); return json(res, 413, { ok: false, message: 'File terlalu besar (maks. 300 MB).' }); }

    if (check) { ctrl.abort(); return json(res, 200, { ok: true, size: total || null, type: type || null }); }

    const ext = /\.(mp3)$/i.test(String(q.name || '')) ? 'mp3' : 'mp4';
    const name = cleanName(q.name, ext);
    const outType = (!type || type === 'application/octet-stream' || type === 'binary/octet-stream') ? (name.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4') : type;

    res.statusCode = up.status;
    res.setHeader('Content-Type', outType);
    res.setHeader('Content-Disposition', 'attachment; filename="' + name.replace(/"/g, '') + '"; filename*=UTF-8\'\'' + encodeURIComponent(name));
    res.setHeader('Accept-Ranges', up.headers.get('accept-ranges') || 'bytes');
    if (up.headers.get('content-range')) res.setHeader('Content-Range', up.headers.get('content-range'));
    if (length) res.setHeader('Content-Length', String(length));
    if (req.method === 'HEAD' || !up.body) { ctrl.abort(); return res.end(); }

    let sent = 0;
    const limiter = new Transform({
      transform(chunk, _enc, cb) {
        sent += chunk.length;
        if (sent > MAX_BYTES) return cb(new Error('too-large'));
        cb(null, chunk);
      }
    });
    pipeline(Readable.fromWeb(up.body), limiter, res, () => { ctrl.abort(); });
  } catch (error) {
    if (connectTimer) clearTimeout(connectTimer);
    if (res.headersSent) { try { res.destroy(); } catch (_) {} return; }
    const timeout = error && error.name === 'AbortError';
    const known = error && /^(Link|Server media|Redirect|Terlalu)/.test(error.message || '');
    return json(res, timeout ? 504 : (known ? 400 : 502), { ok: false, message: timeout ? 'Server media terlalu lama merespons.' : (known ? error.message : 'Server media tidak dapat dihubungi.') });
  }
};
