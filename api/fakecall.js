// Same-origin bridge for the Fake Call API (which may not allow browser CORS).
const endpoint = 'https://api.izzxd.my.id/api/maker/fakecall';
const MAX_AVATAR = 4 * 1024 * 1024;

// Read the raw image from the browser; the server builds multipart for the upstream API.

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Metode tidak didukung.' });
  }
  const query = req.query || {};
  const name = typeof query.nama === 'string' ? query.nama.trim() : '';
  const duration = typeof query.durasi === 'string' ? query.durasi.trim() : '';
  const theme = query.theme;
  if (!name || name.length > 80 || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(duration) || !['android', 'ios'].includes(theme)) {
    return res.status(400).json({ message: 'Isi nama, durasi (contoh 20.12.09), dan tema Android atau iOS.' });
  }
  const imageType = String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  if (!extensions[imageType]) return res.status(415).json({ message: 'Pilih foto JPG, PNG, atau WebP.' });
  if (Number(req.headers['content-length']) > MAX_AVATAR) return res.status(413).json({ message: 'Ukuran foto maksimal 4 MB.' });
  let chunks = [], size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_AVATAR) return res.status(413).json({ message: 'Ukuran foto maksimal 4 MB.' });
      chunks.push(chunk);
    }
  } catch (_) { return res.status(400).json({ message: 'Foto tidak dapat dibaca. Coba unggah ulang.' }); }
  if (!size) return res.status(400).json({ message: 'Pilih foto profil terlebih dahulu.' });
  const form = new FormData();
  form.append('avatar', new Blob(chunks, { type: imageType }), 'avatar.' + extensions[imageType]);
  chunks = [];
  const target = new URL(endpoint);
  target.search = new URLSearchParams({ nama: name, durasi: duration, theme, apikey: process.env.FAKECALL_API_KEY || 'bilyapiforyou' }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50000);
  try {
    const upstream = await fetch(target.toString(), { method: 'POST', body: form, signal: controller.signal, headers: { Accept: 'application/json, text/plain, image/*, */*', 'User-Agent': 'Mozilla/5.0 (compatible; BilyReaction/1.0)' } });
    const type = upstream.headers.get('content-type') || 'application/octet-stream';
    if (!upstream.ok) {
      // Forward a short, plain API message when available, like the React proxy.
      let message = '';
      if (/^(application\/json|text\/plain)(?:\s*;|$)/i.test(type)) {
        const text = (await upstream.text()).slice(0, 1000);
        try {
          const data = JSON.parse(text);
          const value = data.message || data.msg || data.error;
          if (typeof value === 'string') message = value;
        } catch (_) { if (!text.trim().startsWith('<')) message = text; }
      }
      message = message.replace(/[*_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
      // Avoid exposing the configured key if the upstream echoes it.
      const key = process.env.FAKECALL_API_KEY || 'bilyapiforyou';
      if (message.includes(key)) message = '';
      if (!message) message = upstream.status === 403 ? 'API Fake Call menolak akses. Periksa API key atau izin akses dengan penyedia API.' : 'API Fake Call tidak dapat memproses permintaan.';
      return res.status(502).json({ ok: false, upstreamStatus: upstream.status, message });
    }
    if (!/^image\/(png|jpeg|webp|gif)(?:\s*;|$)/i.test(type) && !/^(application\/json|text\/plain)(?:\s*;|$)/i.test(type)) {
      return res.status(502).json({ message: 'Format respons API tidak dikenali.' });
    }
    res.setHeader('Content-Type', type);
    return res.status(200).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    return res.status(502).json({ message: err.name === 'AbortError' ? 'API terlalu lama merespons. Coba lagi.' : 'API Fake Call tidak dapat dihubungi. Coba lagi nanti.' });
  } finally {
    clearTimeout(timer);
  }
};

module.exports.config = { api: { bodyParser: false } };
