// Open-Meteo client. Polls on an interval, keeps the last good reading (also in localStorage
// so a reboot without network still shows the last sky), retries quietly on failure.
import { config } from './config';

export interface MetarLayer { cover: 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'VV'; baseFt: number; type: 'CB' | 'TCU' | null }
export interface Metar { station: string; distanceKm?: number | null; obsTime: number; raw: string; clear: boolean; layers: MetarLayer[]; tempC?: number | null; wx: string | null }

export interface Weather {
  cloudTotal: number; // 0..1
  cloudLow: number;
  cloudMid: number;
  cloudHigh: number;
  precipitation: number; // mm/h
  weatherCode: number; // WMO code
  windSpeed: number; // m/s at 10 m
  windFromDeg: number; // meteorological: direction the wind blows FROM
  visibility: number; // meters
  tempC: number | null; // air temperature at 2 m, °C
  cape: number; // J/kg, convective available potential energy (instability)
  liftedIndex: number; // negative = unstable
  metar: Metar | null; // nearest airport observation, if available
  fetchedAt: number; // epoch ms
}

const CACHE_KEY = 'skylight.weather.v1';

export function loadCachedWeather(): Weather | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const w = JSON.parse(raw) as Weather;
    return typeof w.cloudTotal === 'number' ? w : null;
  } catch {
    return null;
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export async function fetchWeather(signal?: AbortSignal): Promise<Weather> {
  const { lat, lon } = config.location;
  const vars = [
    'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
    'precipitation', 'weather_code', 'wind_speed_10m', 'wind_direction_10m', 'visibility', 'cape', 'lifted_index', 'temperature_2m',
  ].join(',');
  // Rounded to ~1 km before leaving the device: plenty for weather, less identifying.
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=${vars}&wind_speed_unit=ms&timezone=auto`;
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = await res.json();
  const c = json?.current;
  if (!c) throw new Error('Open-Meteo: no current block');
  const total = num(c.cloud_cover, 0) / 100;
  const w: Weather = {
    cloudTotal: total,
    // If the layered values are missing, attribute everything to the low layer.
    cloudLow: num(c.cloud_cover_low, total * 100) / 100,
    cloudMid: num(c.cloud_cover_mid, 0) / 100,
    cloudHigh: num(c.cloud_cover_high, 0) / 100,
    precipitation: num(c.precipitation, 0),
    weatherCode: num(c.weather_code, 0),
    windSpeed: num(c.wind_speed_10m, 3),
    windFromDeg: num(c.wind_direction_10m, 270),
    visibility: num(c.visibility, 24000),
    cape: num(c.cape, 0),
    tempC: typeof c.temperature_2m === 'number' ? c.temperature_2m : null,
    liftedIndex: num(c.lifted_index, 5),
    metar: null,
    fetchedAt: Date.now(),
  };
  return w;
}

/**
 * Latest METAR via our own /api/metar relay (a Vercel function). Optional: if it's unavailable
 * (local dev, offline, upstream down) the app runs on Open-Meteo alone. Reports older than
 * 3 hours are ignored.
 */
export async function fetchMetar(signal?: AbortSignal): Promise<Metar | null> {
  try {
    const { lat, lon } = config.location;
    const sep = config.metarUrl.includes('?') ? '&' : '?';
    const res = await fetch(`${config.metarUrl}${sep}lat=${lat.toFixed(1)}&lon=${lon.toFixed(1)}`, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const m = (await res.json()) as Metar & { error?: string };
    if (m.error || !Array.isArray(m.layers)) return null;
    if (Date.now() - m.obsTime > 3 * 3600_000) return null;
    return m;
  } catch {
    return null;
  }
}

/** Starts polling. Calls onUpdate with each successful reading. Never throws.
 * Returns { stop, refresh }: refresh() fetches immediately (e.g. after the location changes). */
export function startWeatherPolling(onUpdate: (w: Weather) => void, onStatus?: (s: string) => void): { stop: () => void; refresh: () => void } {
  let timer: number | undefined;
  let stopped = false;
  let inFlight = false;
  let pending = false; // a refresh requested mid-request runs right after it
  const run = async () => {
    if (stopped) return;
    if (inFlight) { pending = true; return; }
    inFlight = true;
    clearTimeout(timer);
    const ctrl = new AbortController();
    const to = window.setTimeout(() => ctrl.abort(), 15000);
    try {
      const [w, metar] = await Promise.all([fetchWeather(ctrl.signal), fetchMetar(ctrl.signal)]);
      w.metar = metar;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(w)); } catch { /* storage may be unavailable */ }
      onStatus?.('ok');
      onUpdate(w);
      timer = window.setTimeout(run, config.weather.pollMinutes * 60_000);
    } catch (err) {
      onStatus?.(`retrying (${(err as Error).message})`);
      timer = window.setTimeout(run, config.weather.retrySeconds * 1000);
    } finally {
      clearTimeout(to);
      inFlight = false;
      if (pending) { pending = false; run(); }
    }
  };
  run();
  return { stop: () => { stopped = true; clearTimeout(timer); }, refresh: () => { run(); } };
}
