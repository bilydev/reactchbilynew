// Same-origin bridge for the Fake Call API (which may not allow browser CORS).
const endpoint = 'https://api.izzxd.my.id/api/maker/fakecall';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ message: 'Metode tidak didukung.' });
  }
  const query = req.query || {};
  const name = typeof query.nama === 'string' ? query.nama.trim() : '';
  const duration = typeof query.durasi === 'string' ? query.durasi.trim() : '';
  const theme = query.theme;
  if (!name || name.length > 80 || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(duration) || !['android', 'ios'].includes(theme)) {
    return res.status(400).json({ message: 'Isi nama, durasi (contoh 20.12.09), dan tema Android atau iOS.' });
  }
  const target = new URL(endpoint);
  target.search = new URLSearchParams({ nama: name, durasi: duration, theme, apikey: 'bilyapiforyou' }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50000);
  try {
    const upstream = await fetch(target.toString(), { signal: controller.signal, headers: { Accept: 'image/*, application/json, text/plain, */*' } });
    if (!upstream.ok) return res.status(502).json({ message: 'API Fake Call membalas kode ' + upstream.status + '.' });
    const type = upstream.headers.get('content-type') || 'application/octet-stream';
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
