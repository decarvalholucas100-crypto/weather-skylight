// The renderer never sees "modes" or "weather". It sees one SkyParams object.
// Modes, live weather and dev overrides all produce a *target* SkyParams; the current
// params ease toward it so nothing ever hard-cuts.
import { altOf, computeAstro, dirFromAltAz, type Astro, type Vec3 } from './astro';
import { config, type ModeName } from './config';
import type { Weather } from './weather';

export interface SkyParams {
  sunDir: Vec3;
  moonDir: Vec3;
  moonFraction: number;
  cloudLow: number; // 0..1 coverage of the volumetric cumulus/stratus layer
  cloudMid: number; // altocumulus / altostratus
  cloudHigh: number; // cirrus
  storminess: number; // 0..1: thicker, darker, lower cloud base
  rain: number; // 0..1 intensity
  windX: number; // m/s at cloud height, direction clouds MOVE toward (east +)
  windY: number; // north +
  haze: number; // 0..1 from visibility / fog
  lightning: number; // 0..1 how often lightning flickers
}

export interface DevOverrides {
  cloud?: number;
  rain?: number;
  windSpeed?: number;
  windToDeg?: number;
  lightning?: boolean;
}

interface ModeSpec {
  label: string;
  sun: 'real' | { alt: number; az: number };
  moon: 'real' | 'visible';
  weather: 'live' | Partial<Omit<SkyParams, 'sunDir' | 'moonDir' | 'moonFraction'>>;
}

// All five modes are just different inputs into the same renderer.
export const MODES: Record<ModeName, ModeSpec> = {
  live: { label: 'Live', sun: 'real', moon: 'real', weather: 'live' },
  sunny: {
    label: 'Always Sunny', sun: 'real', moon: 'real',
    weather: { cloudLow: 0.0, cloudMid: 0, cloudHigh: 0.08, storminess: 0, rain: 0, haze: 0.05, lightning: 0, windX: 4, windY: 1 },
  },
  clearNight: {
    label: 'Clear Night', sun: { alt: -32, az: 0 }, moon: 'visible',
    weather: { cloudLow: 0, cloudMid: 0, cloudHigh: 0, storminess: 0, rain: 0, haze: 0.05, lightning: 0, windX: 2, windY: 1 },
  },
  cloudyNight: {
    label: 'Cloudy Night', sun: { alt: -32, az: 0 }, moon: 'visible',
    weather: { cloudLow: 0.5, cloudMid: 0.25, cloudHigh: 0.25, storminess: 0, rain: 0, haze: 0.1, lightning: 0, windX: 6, windY: 2 },
  },
  golden: {
    label: 'Golden Hour', sun: { alt: 3.5, az: 250 }, moon: 'real',
    weather: { cloudLow: 0.38, cloudMid: 0.25, cloudHigh: 0.35, storminess: 0, rain: 0, haze: 0.15, lightning: 0, windX: 5, windY: 2 },
  },
  storm: {
    label: 'Storm', sun: 'real', moon: 'real',
    weather: { cloudLow: 1, cloudMid: 0.9, cloudHigh: 0.5, storminess: 1, rain: 0.9, haze: 0.25, lightning: 1, windX: 11, windY: 6 },
  },
};

/** Translate an Open-Meteo reading into renderer terms. */
export function weatherToParams(w: Weather): Omit<SkyParams, 'sunDir' | 'moonDir' | 'moonFraction'> {
  const code = w.weatherCode;
  const isThunder = code >= 95;
  const isRainCode = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || isThunder;
  const isSnowCode = (code >= 71 && code <= 77) || code === 85 || code === 86;
  const isFog = code === 45 || code === 48;

  // Precipitation in mm/h: 0.5 drizzle, 2-4 moderate, 8+ heavy.
  let rain = Math.min(1, Math.sqrt(Math.max(0, w.precipitation) / 8));
  if (isRainCode) rain = Math.max(rain, code >= 61 ? 0.35 : 0.15);
  if (isSnowCode) rain = Math.min(rain, 0.25); // snow: gray sky, light wetness on glass

  let storminess = 0;
  if (isThunder) storminess = 1;
  else if (rain > 0) storminess = 0.35 + 0.5 * rain;
  else if (w.cloudLow > 0.85) storminess = 0.25;

  // Visibility: 24 km+ is crystal clear; under 1 km is fog.
  const vis = Math.max(50, w.visibility);
  let haze = Math.min(1, Math.max(0, Math.log(24000 / vis) / Math.log(24000 / 300)));
  if (isFog) haze = Math.max(haze, 0.8);

  // Wind: convert "from" direction to the direction clouds travel, scale up to cloud height.
  const speed = w.windSpeed * config.weather.cloudWindMultiplier;
  const toRad = ((w.windFromDeg + 180) * Math.PI) / 180;

  return {
    // A full overcast reads as a solid gray ceiling from the ground, whichever height band
    // Open-Meteo assigns it to (an altostratus deck often shows up as 'mid' with low = 0).
    cloudLow: Math.max(w.cloudLow, rain > 0 ? 0.85 : 0, w.cloudTotal > 0.7 ? Math.min(1, (w.cloudTotal - 0.7) / 0.3) * 0.95 : 0),
    cloudMid: w.cloudMid,
    cloudHigh: w.cloudHigh,
    storminess,
    rain,
    windX: Math.sin(toRad) * speed,
    windY: Math.cos(toRad) * speed,
    haze,
    lightning: isThunder ? (code >= 96 ? 1 : 0.6) : 0,
  };
}

const DEFAULT_WEATHER: Omit<SkyParams, 'sunDir' | 'moonDir' | 'moonFraction'> = {
  cloudLow: 0.3, cloudMid: 0.1, cloudHigh: 0.2, storminess: 0, rain: 0, windX: 5, windY: 2, haze: 0.1, lightning: 0,
};

export function buildTarget(
  mode: ModeName,
  astro: Astro,
  weather: Weather | null,
  dev: DevOverrides,
): SkyParams {
  const spec = MODES[mode];
  const sunDir = spec.sun === 'real' ? astro.sunDir : dirFromAltAz(spec.sun.alt, spec.sun.az);
  let moonDir = astro.moonDir;
  if (spec.moon === 'visible' && altOf(moonDir) < 50) moonDir = dirFromAltAz(72, 175);

  const base = spec.weather === 'live' ? (weather ? weatherToParams(weather) : DEFAULT_WEATHER) : { ...DEFAULT_WEATHER, ...spec.weather };
  // Illuminated fraction from the actual sun-moon geometry (matches the drawn phase, and stays
  // consistent when a mode places the sun or moon somewhere other than their real positions).
  const elong = sunDir[0] * moonDir[0] + sunDir[1] * moonDir[1] + sunDir[2] * moonDir[2];
  const p: SkyParams = { sunDir, moonDir, moonFraction: (1 - elong) / 2, ...base };

  if (dev.cloud !== undefined) {
    p.cloudLow = dev.cloud;
    p.cloudMid = Math.min(1, dev.cloud * 0.6);
    p.cloudHigh = Math.min(1, 0.15 + dev.cloud * 0.4);
    if (dev.rain === undefined) p.storminess = dev.cloud > 0.9 ? 0.3 : 0;
  }
  if (dev.rain !== undefined) {
    p.rain = dev.rain;
    if (dev.rain > 0.02) {
      p.cloudLow = Math.max(p.cloudLow, 0.9);
      p.storminess = Math.max(p.storminess, 0.35 + 0.5 * dev.rain);
      p.haze = Math.max(p.haze, 0.25 * dev.rain);
    }
  }
  if (dev.windSpeed !== undefined || dev.windToDeg !== undefined) {
    const cur = Math.hypot(p.windX, p.windY);
    const curDir = Math.atan2(p.windX, p.windY);
    const s = dev.windSpeed ?? cur;
    const d = dev.windToDeg !== undefined ? (dev.windToDeg * Math.PI) / 180 : curDir;
    p.windX = Math.sin(d) * s;
    p.windY = Math.cos(d) * s;
  }
  if (dev.lightning !== undefined) p.lightning = dev.lightning ? 1 : 0;
  return p;
}

export function cloneParams(p: SkyParams): SkyParams {
  return { ...p, sunDir: [...p.sunDir] as Vec3, moonDir: [...p.moonDir] as Vec3 };
}

function easeVec(cur: Vec3, tgt: Vec3, k: number): Vec3 {
  const v: Vec3 = [cur[0] + (tgt[0] - cur[0]) * k, cur[1] + (tgt[1] - cur[1]) * k, cur[2] + (tgt[2] - cur[2]) * k];
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

const WEATHER_KEYS = ['cloudLow', 'cloudMid', 'cloudHigh', 'storminess', 'rain', 'windX', 'windY', 'haze', 'lightning'] as const;

/**
 * Exponential easing. astroTau governs sun/moon (short, so time scrubbing stays responsive);
 * weatherTau governs everything else (minutes for real weather, seconds for mode changes).
 */
export function easeParams(cur: SkyParams, tgt: SkyParams, dt: number, astroTau: number, weatherTau: number): void {
  const ka = 1 - Math.exp(-dt / Math.max(1e-3, astroTau));
  const kw = 1 - Math.exp(-dt / Math.max(1e-3, weatherTau));
  cur.sunDir = easeVec(cur.sunDir, tgt.sunDir, ka);
  cur.moonDir = easeVec(cur.moonDir, tgt.moonDir, ka);
  cur.moonFraction += (tgt.moonFraction - cur.moonFraction) * ka;
  for (const k of WEATHER_KEYS) cur[k] += (tgt[k] - cur[k]) * kw;
}

export { computeAstro };
