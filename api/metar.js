// Vercel serverless function: GET /api/metar[?lat=..&lon=..]
// Relays the latest METAR from the NOAA Aviation Weather Center (aviationweather.gov, public,
// no key). With lat/lon it picks the nearest reporting airport (within ~110 km) that has a
// recent report; without, it uses the configured default stations. Running server-side avoids
// browser CORS limits and lets Vercel's edge cache responses for all skylights.
// Response: { station, distanceKm, obsTime, raw, clear, layers: [{ cover, baseFt, type }],
//             tempC, wx } or { error }.

const DEFAULT_STATIONS = process.env.METAR_STATIONS || 'KJFK,KLGA,KFRG';

function parseLayers(raw) {
  const layers = [];
  const re = /\b(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?\b/g;
  let m;
  while ((m = re.exec(raw))) layers.push({ cover: m[1], baseFt: Number(m[2]) * 100, type: m[3] || null });
  return layers;
}

function distKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

export default async function handler(req, res) {
  try {
    const q = new URL(req.url, 'http://x').searchParams;
    const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
    const haveLoc = q.has('lat') && q.has('lon') && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    // Round the location so nearby skylights share a cached response.
    const rl = haveLoc ? Math.round(lat * 10) / 10 : 0, ro = haveLoc ? Math.round(lon * 10) / 10 : 0;
    const url = haveLoc
      ? `https://aviationweather.gov/api/data/metar?bbox=${rl - 1},${ro - 1.3},${rl + 1},${ro + 1.3}&format=json`
      : `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(DEFAULT_STATIONS)}&format=json`;
    const r = await fetch(url, { headers: { 'User-Agent': 'skylight-display (weather visualization)' } });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const data = await r.json();
    const now = Date.now();
    let list = (Array.isArray(data) ? data : []).filter((o) => typeof o.rawOb === 'string' && o.rawOb.length > 10)
      .filter((o) => !o.obsTime || now - o.obsTime * 1000 < 3 * 3600_000);
    if (haveLoc) {
      list = list.map((o) => ({ o, d: distKm(lat, lon, o.lat, o.lon) })).filter((x) => Number.isFinite(x.d) && x.d < 110)
        .sort((a, b) => a.d - b.d).map((x) => Object.assign(x.o, { _d: x.d }));
    } else {
      const order = DEFAULT_STATIONS.split(',');
      list.sort((a, b) => order.indexOf(a.icaoId) - order.indexOf(b.icaoId));
    }
    const ob = list[0];
    if (!ob) throw new Error('no nearby report');
    const raw = ob.rawOb;
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({
      station: ob.icaoId,
      name: ob.name || null,
      distanceKm: ob._d != null ? Math.round(ob._d) : null,
      obsTime: ob.obsTime ? ob.obsTime * 1000 : now,
      raw,
      clear: /\b(CLR|SKC|NCD|NSC|CAVOK)\b/.test(raw),
      layers: parseLayers(raw),
      tempC: typeof ob.temp === 'number' ? ob.temp : null,
      wx: ob.wxString || null,
    });
  } catch (err) {
    res.setHeader('Cache-Control', 's-maxage=60');
    res.status(502).json({ error: String(err && err.message ? err.message : err) });
  }
}
