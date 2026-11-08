// Where the skylight is. Starts from config (the installation address), then upgrades to the
// browser's real location if the person allows it. The last known fix is cached so a reboot
// without network or permission still uses it. On a Pi kiosk geolocation is usually
// unavailable (no Wi-Fi positioning key in Chromium builds), so the config address applies.
import { config } from './config';
import { estimateLightPollution, type City } from './cities';

export interface Place {
  lat: number;
  lon: number;
  timeZone: string;
  source: 'config' | 'browser' | 'cached' | 'city';
  name?: string;
  accuracyM?: number;
  updatedAt?: number;
}

const KEY = 'skylight.location.v1';
const CITY_KEY = 'skylight.city.v1'; // a city picked in the dev panel (overrides the browser fix)
// The fallback location: whatever config holds when first asked (after any URL override).
let fallback: Place | null = null;
function defaultPlace(): Place {
  if (!fallback) fallback = { lat: config.location.lat, lon: config.location.lon, timeZone: config.location.timeZone, source: 'config' };
  return { ...fallback };
}

let current: Place | null = null;
const listeners: ((p: Place) => void)[] = [];

function apply(p: Place): void {
  const cur = current ?? defaultPlace();
  const moved = Math.abs(p.lat - cur.lat) > 0.005 || Math.abs(p.lon - cur.lon) > 0.005 || p.timeZone !== cur.timeZone;
  current = p;
  // Everything else (sun/moon, weather, sidereal time, clock) reads config.location.
  config.location.lat = p.lat;
  config.location.lon = p.lon;
  config.location.timeZone = p.timeZone;
  // Sky darkness follows the location (Clear Night mode overrides it with a dark sky).
  config.lightPollution = estimateLightPollution(p.lat, p.lon);
  if (moved) listeners.forEach((l) => l(p));
}

export function getPlace(): Place {
  return current ?? defaultPlace();
}

export function onPlaceChange(fn: (p: Place) => void): void {
  listeners.push(fn);
}

/** The device's own time zone: correct for wherever the browser actually is. */
function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || config.location.timeZone;
  } catch {
    return config.location.timeZone;
  }
}

function locate(prompt: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p: Place = {
          lat: Math.round(pos.coords.latitude * 1e4) / 1e4,
          lon: Math.round(pos.coords.longitude * 1e4) / 1e4,
          timeZone: deviceTimeZone(),
          source: 'browser',
          accuracyM: Math.round(pos.coords.accuracy),
          updatedAt: Date.now(),
        };
        try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
        apply(p);
        resolve(true);
      },
      () => resolve(false),
      { enableHighAccuracy: false, timeout: prompt ? 30000 : 15000, maximumAge: 10 * 60_000 },
    );
  });
}

/**
 * Initialise: use the cached fix if any, then ask the browser. The permission prompt appears at
 * most once (the browser remembers the answer); afterwards it refreshes every 30 minutes.
 * Set ?geo=0 to skip geolocation entirely and use the configured address.
 */
/** Synchronously apply the last browser fix, so the very first weather request uses it. */
export function loadCachedPlace(enabled: boolean): void {
  // A city chosen in the panel wins over everything else.
  try {
    const cr = localStorage.getItem(CITY_KEY);
    if (cr) { const c = JSON.parse(cr) as Place; if (Number.isFinite(c.lat)) { apply(c); return; } }
  } catch { /* ignore */ }
  config.lightPollution = estimateLightPollution(config.location.lat, config.location.lon);
  if (!enabled) return;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw) as Place;
      if (Number.isFinite(c.lat) && Number.isFinite(c.lon)) apply({ ...c, source: 'cached' });
    }
  } catch { /* ignore */ }
}

export async function initLocation(enabled: boolean): Promise<void> {
  if (!enabled || current?.source === 'city') return;
  let state: PermissionState | 'unknown' = 'unknown';
  try {
    state = (await navigator.permissions.query({ name: 'geolocation' as PermissionName })).state;
  } catch { /* Permissions API missing: just try */ }
  if (state === 'denied') return;
  await locate(state !== 'granted');
  setInterval(() => { locate(false); }, 30 * 60_000);
}

/** Dev panel: ask now (re-prompts only if the browser allows it). */
export function useMyLocation(): Promise<boolean> {
  try { localStorage.removeItem(CITY_KEY); } catch { /* ignore */ }
  return locate(true);
}

/** Dev panel: jump to a city (persists until 'Use my location' or 'Reset'). */
export function setCity(c: City): void {
  const p: Place = { lat: c.lat, lon: c.lon, timeZone: c.tz, source: 'city', name: c.name, updatedAt: Date.now() };
  try { localStorage.setItem(CITY_KEY, JSON.stringify(p)); } catch { /* ignore */ }
  apply(p);
}

/** Dev panel: forget the browser fix and go back to the configured address. */
export function resetLocation(): void {
  try { localStorage.removeItem(KEY); localStorage.removeItem(CITY_KEY); } catch { /* ignore */ }
  apply(defaultPlace());
}
