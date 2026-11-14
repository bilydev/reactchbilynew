// Fixed same-origin bridge for the two image makers; file body parsing is disabled.
const BASE = 'https://api.izzxd.my.id/api/maker/';
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {}, kind = q.kind;
  if (!['dana', 'wasted'].includes(kind)) return res.status(400).json({ message: 'Jenis maker tidak dikenal.' });
  const expected = kind === 'dana' ? 'GET' : 'POST';
  if (req.method !== expected) { res.setHeader('Allow', expected); return res.status(405).json({ message: 'Metode tidak didukung.' }); }
  const target = new URL(BASE + (kind === 'dana' ? 'fake-dana' : 'wasted'));
  let form;
  if (kind === 'dana') {
    const saldo = typeof q.saldo === 'string' ? q.saldo : '';
    if (!/^\d{1,3}(?:\.\d{3}){0,4}$/.test(saldo)) return res.status(400).json({ message: 'Masukkan nominal yang valid.' });
    target.searchParams.set('saldo', saldo); target.searchParams.set('theme', 'basic');
  } else {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!TYPES[type]) return res.status(415).json({ message: 'Pilih foto JPG, PNG, atau WebP.' });
    if (Number(req.headers['content-length']) > 4 * 1024 * 1024) return res.status(413).json({ message: 'Ukuran foto maksimal 4 MB.' });
    let size = 0, chunks = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) return res.status(413).json({ message: 'Ukuran foto maksimal 4 MB.' });
        chunks.push(chunk);
      }
    } catch (_) { return res.status(400).json({ message: 'Foto tidak dapat dibaca.' }); }
    if (!size) return res.status(400).json({ message: 'Pilih foto terlebih dahulu.' });
    form = new FormData(); form.append('image', new Blob(chunks, { type }), 'image.' + TYPES[type]); chunks = [];
  }
  target.searchParams.set('apikey', process.env.BILY_MAKER_API_KEY || 'bilyapiforyou');
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 50000);
  try {
    const up = await fetch(target.toString(), { method: expected, body: form, signal: ctrl.signal, headers: { Accept: 'image/*, application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0 (compatible; BilyReaction/1.0)' } });
    if (up.status === 429) return res.status(429).json({ message: 'Terlalu banyak permintaan. Coba lagi nanti.' });
    if (!up.ok) return res.status(502).json({ message: 'API maker membalas kode ' + up.status + '. Coba lagi nanti.' });
    const type = up.headers.get('content-type') || '';
    if (!/^(image\/(png|jpeg|webp|gif)|application\/json|text\/plain)(?:\s*;|$)/i.test(type)) return res.status(502).json({ message: 'Format respons API tidak dikenali.' });
    res.setHeader('Content-Type', type);
    return res.status(200).send(Buffer.from(await up.arrayBuffer()));
  } catch (e) { return res.status(502).json({ message: e.name === 'AbortError' ? 'API terlalu lama merespons.' : 'API maker tidak dapat dihubungi.' }); }
  finally { clearTimeout(timer); }
};
module.exports.config = { api: { bodyParser: false } };
