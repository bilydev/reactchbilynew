// Same-origin proxy for Nexray's downloader. Only the fixed upstream is requested.
const ENDPOINT = 'https://api.nexray.eu.cc/downloader/aio';
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: 'Metode tidak didukung.' });
  }
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
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    return res.status(502).json({ ok: false, message: error.name === 'AbortError' ? 'API terlalu lama merespons. Coba lagi.' : 'API downloader tidak dapat dihubungi. Coba lagi nanti.' });
  } finally { clearTimeout(timer); }
};
