// Vercel serverless function: GET /api/metar
// Relays the latest METAR for the nearest airports from the NOAA Aviation Weather Center
// (aviationweather.gov, public, no key). Running it server-side avoids browser CORS limits and
// lets Vercel's edge cache it, so every skylight shares one upstream request per few minutes.
// Response: { station, obsTime, raw, layers: [{ cover, baseFt, type }], wx } or { error }.

const STATIONS = process.env.METAR_STATIONS || 'KJFK,KLGA,KFRG';

function parseLayers(raw) {
  const layers = [];
  const re = /\b(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?\b/g;
  let m;
  while ((m = re.exec(raw))) layers.push({ cover: m[1], baseFt: Number(m[2]) * 100, type: m[3] || null });
  return layers;
}

export default async function handler(req, res) {
  try {
    const url = `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(STATIONS)}&format=json`;
    const r = await fetch(url, { headers: { 'User-Agent': 'skylight-display (weather visualization)' } });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const data = await r.json();
    const list = Array.isArray(data) ? data : [];
    // Keep the configured station order: first station with a usable report wins.
    const order = STATIONS.split(',');
    list.sort((a, b) => order.indexOf(a.icaoId) - order.indexOf(b.icaoId));
    const ob = list.find((o) => typeof o.rawOb === 'string' && o.rawOb.length > 10);
    if (!ob) throw new Error('no report');
    const raw = ob.rawOb;
    const clear = /\b(CLR|SKC|NCD|NSC|CAVOK)\b/.test(raw);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({
      station: ob.icaoId,
      obsTime: ob.obsTime ? ob.obsTime * 1000 : Date.parse(ob.reportTime || '') || Date.now(),
      raw,
      clear,
      layers: parseLayers(raw),
      wx: ob.wxString || null,
    });
  } catch (err) {
    res.setHeader('Cache-Control', 's-maxage=60');
    res.status(502).json({ error: String(err && err.message ? err.message : err) });
  }
}
