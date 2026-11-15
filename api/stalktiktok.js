/* ============================================================
   api/stalktiktok.js — jembatan same-origin ke Nexray Stalker TikTok.
   GET /api/stalktiktok?username=aulia.love.bily
   Balasan: { ok:true, data } atau { ok:false, message } dengan kode HTTP error.
   Hanya info profil publik yang diteruskan apa adanya dari API.
   ============================================================ */
const ENDPOINT = 'https://api.nexray.eu.cc/stalker/tiktok';
const MAX_TEXT = 1024 * 1024;
const TIMEOUT = 30000;

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

// "@nama", spasi, atau "+" di ujung (spasi yang ter-encode) dibuang; hanya karakter username TikTok yang lolos.
function cleanUsername(value) {
  const name = String(value || '').trim().replace(/^@+/, '').replace(/[+\s]+$/, '');
  return /^[A-Za-z0-9._]{2,24}$/.test(name) ? name : '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { ok: false, message: 'Metode tidak didukung.' });
  }
  if (limited(req, 20, 60000)) { res.setHeader('Retry-After', '30'); return json(res, 429, { ok: false, message: 'Terlalu banyak permintaan. Coba lagi nanti.' }); }

  const username = cleanUsername((req.query || {}).username);
  if (!username) return json(res, 400, { ok: false, message: 'Username tidak valid.' });

  const target = new URL(ENDPOINT);
  target.searchParams.set('username', username);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const up = await fetch(target.toString(), { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; BilyReaction/1.0)' } });
    if (up.status === 429) return json(res, 429, { ok: false, message: 'Terlalu banyak permintaan. Coba lagi nanti.' });
    const text = (await up.text()).slice(0, MAX_TEXT);
    let data = null; try { data = JSON.parse(text); } catch (_) {}
    const failed = !up.ok || !data || typeof data !== 'object' ||
      data.status === false || data.success === false || data.ok === false || data.error || (typeof data.status === 'number' && data.status >= 400);
    if (failed) {
      const v = data && typeof data === 'object' ? (data.message || data.msg || data.error) : '';
      const message = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      const notFound = up.status === 404 || /not.?found|tidak ditemukan|no such|invalid user/i.test(message);
      return json(res, notFound ? 404 : 502, { ok: false, message: notFound ? 'Username tidak ditemukan.' : (message || 'API membalas kode ' + up.status + '.') });
    }
    return json(res, 200, { ok: true, data });
  } catch (error) {
    return json(res, 502, { ok: false, message: error.name === 'AbortError' ? 'API terlalu lama merespons. Coba lagi.' : 'API tidak dapat dihubungi. Coba lagi nanti.' });
  } finally { clearTimeout(timer); }
};
