// Same-origin proxy for Nexray's downloader. Only the fixed upstream is requested.
const crypto = require('crypto');
const ENDPOINT = 'https://api.nexray.eu.cc/downloader/aio';

// Rate limit per IP (in-memory per instance, jadi best-effort).
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

// Tanda tangan tiap link media agar /api/dlfile hanya mau mengunduh link dari hasil API ini.
// Aktif jika Environment Variable DL_SECRET diisi di Vercel.
function signLinks(data) {
  const secret = process.env.DL_SECRET;
  if (!secret) return undefined;
  const exp = String(Math.floor(Date.now() / 1000) + 30 * 60);
  const sig = {};
  let count = 0;
  (function walk(v, depth) {
    if (v == null || depth > 8 || count >= 300) return;
    if (typeof v === 'string') {
      if (v.length > 4096 || !/^https?:\/\//i.test(v) || sig[v]) return;
      sig[v] = exp + '.' + crypto.createHmac('sha256', secret).update(exp + '|' + v).digest('hex');
      count++;
    } else if (Array.isArray(v)) v.forEach(x => walk(x, depth + 1));
    else if (typeof v === 'object') Object.values(v).forEach(x => walk(x, depth + 1));
  })(data, 0);
  return sig;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: 'Metode tidak didukung.' });
  }
  if (limited(req, 20, 60000)) { res.setHeader('Retry-After', '30'); return res.status(429).json({ ok: false, message: 'Terlalu banyak permintaan. Coba lagi nanti.' }); }
  const input = typeof (req.query || {}).url === 'string' ? req.query.url.trim() : '';
  let inputUrl;
  try { inputUrl = new URL(input); } catch (_) {}
  if (!inputUrl || !['http:', 'https:'].includes(inputUrl.protocol) || !inputUrl.hostname || input.length > 2048 || inputUrl.username || inputUrl.password)
    return res.status(400).json({ ok: false, message: 'Masukkan link http atau https yang valid.' });
  const target = new URL(ENDPOINT);
  target.searchParams.set('url', input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50000);
  try {
    const upstream = await fetch(target.toString(), { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; BilyReaction/1.0)' } });
    if (upstream.status === 429) return res.status(429).json({ ok: false, message: 'Terlalu banyak permintaan. Coba lagi nanti.' });
    if (!upstream.ok) return res.status(502).json({ ok: false, message: 'API downloader membalas kode ' + upstream.status + '.' });
    if (Number(upstream.headers.get('content-length')) > 2 * 1024 * 1024) return res.status(502).json({ ok: false, message: 'Respons API terlalu besar.' });
    const text = await upstream.text();
    if (text.length > 2 * 1024 * 1024) return res.status(502).json({ ok: false, message: 'Respons API terlalu besar.' });
    let data;
    try { data = JSON.parse(text); } catch (_) { return res.status(502).json({ ok: false, message: 'Respons API bukan JSON yang valid.' }); }
    if (!data || typeof data !== 'object') return res.status(502).json({ ok: false, message: 'Respons API tidak dikenali.' });
    if (data.status === false || data.success === false || data.ok === false || data.error || (typeof data.status === 'number' && data.status >= 400)) {
      const value = data.message || data.msg || data.error;
      const message = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      return res.status(502).json({ ok: false, message: message || 'API tidak dapat memproses link ini.' });
    }
    return res.status(200).json({ ok: true, data, sig: signLinks(data) });
  } catch (error) {
    return res.status(502).json({ ok: false, message: error.name === 'AbortError' ? 'API terlalu lama merespons. Coba lagi.' : 'API downloader tidak dapat dihubungi. Coba lagi nanti.' });
  } finally { clearTimeout(timer); }
};
