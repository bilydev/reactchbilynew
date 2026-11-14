// Forward an image or video as the upstream multipart `file` field.
const ENDPOINT = 'https://api.izzxd.my.id/api/uploader/top4top';
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov'
};
function findUrl(data, depth = 0) {
  if (depth > 5 || data == null) return '';
  if (typeof data === 'string') {
    try { const u = new URL(data.trim()); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch (_) { return ''; }
  }
  if (typeof data !== 'object') return '';
  for (const key of ['url', 'result', 'data', 'file', 'link']) {
    const url = findUrl(data[key], depth + 1);
    if (url) return url;
  }
  return '';
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Metode tidak didukung.' });
  }
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!TYPES[type]) return res.status(415).json({ ok: false, message: 'Pilih gambar JPG, PNG, WebP, GIF atau video MP4, WebM, MOV.' });
  if (Number(req.headers['content-length']) > MAX_BYTES) return res.status(413).json({ ok: false, message: 'Ukuran file maksimal 4 MB.' });
  let size = 0, chunks = [];
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BYTES) return res.status(413).json({ ok: false, message: 'Ukuran file maksimal 4 MB.' });
      chunks.push(chunk);
    }
  } catch (_) { return res.status(400).json({ ok: false, message: 'File tidak dapat dibaca. Pilih ulang file.' }); }
  if (!size) return res.status(400).json({ ok: false, message: 'File kosong. Pilih file lain.' });
  const form = new FormData();
  form.append('file', new Blob(chunks, { type }), 'upload.' + TYPES[type]);
  chunks = [];
  const target = new URL(ENDPOINT);
  target.searchParams.set('apikey', process.env.TOP4TOP_API_KEY || 'bilyapiforyou');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50000);
  try {
    const upstream = await fetch(target, { method: 'POST', body: form, signal: controller.signal, headers: { Accept: 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0 (compatible; BilyReaction/1.0)' } });
    if (upstream.status === 429) return res.status(429).json({ ok: false, message: 'Terlalu banyak permintaan. Coba lagi nanti.' });
    const raw = await upstream.text();
    let data; try { data = JSON.parse(raw); } catch (_) { data = raw.trim(); }
    if (!upstream.ok || (data && typeof data === 'object' && (data.status === false || data.success === false || data.ok === false || data.error))) {
      const candidate = data && typeof data === 'object' ? (data.message || data.msg || data.error) : '';
      let message = typeof candidate === 'string' ? candidate.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      const key = process.env.TOP4TOP_API_KEY || 'bilyapiforyou';
      if (message.includes(key)) message = '';
      return res.status(502).json({ ok: false, message: message || ('Upload gagal. API membalas kode ' + upstream.status + '.') });
    }
    const url = findUrl(data);
    if (!url) return res.status(502).json({ ok: false, message: 'API tidak mengembalikan URL yang valid.' });
    return res.status(200).json({ ok: true, url });
  } catch (error) {
    return res.status(502).json({ ok: false, message: error.name === 'AbortError' ? 'API terlalu lama merespons. Coba lagi.' : 'API upload tidak dapat dihubungi. Coba lagi nanti.' });
  } finally { clearTimeout(timer); }
};
module.exports.config = { api: { bodyParser: false } };
