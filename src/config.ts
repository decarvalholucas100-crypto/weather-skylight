// Central configuration. Everything a person might want to tune lives here.

export type QualityName = 'high' | 'medium' | 'low';
export type ModeName = 'live' | 'sunny' | 'partly' | 'clearNight' | 'cloudyNight' | 'golden' | 'storm';

export interface QualityPreset {
  /** Fraction of the screen resolution the sky is rendered at, then upscaled. */
  renderScale: number;
  /** Hard cap on internal render width in pixels (keeps 4K TVs cheap). */
  maxInternalWidth: number;
  /** Raymarch steps through the main cloud layer. 0 = use the cheap 2D cloud technique. */
  cloudSteps: number;
  /** Steps toward the sun/moon for cloud self-shadowing. */
  lightSteps: number;
  /** Primary samples for the atmosphere (sky color) lookup table. */
  skySamples: number;
  /** Cap on the final output width (the full-res pass that draws rain, moon, stars). */
  outputMaxWidth: number;
  /** Number of cirrus strands (instanced ribbons). */
  cirrusStrands: number;
  /** Cloud noise volume resolution (64 is generated instantly; larger arrives a few seconds later). */
  noiseSize: number;
}

export const config = {
  location: {
    // Generic default only. The real location comes from the browser (asked once) or, on a
    // kiosk, from ?lat=..&lon=.. in the URL configured on the device itself. Keep personal
    // addresses out of this file: it ships to every browser that opens the app.
    name: 'New York City (default)',
    lat: 40.7128,
    lon: -74.006,
    /** IANA time zone of the installation (used by the dev panel's time-of-day slider). */
    timeZone: 'America/New_York',
  },

  /** Which compass direction the TOP of the screen faces when mounted on the ceiling. 0 = north. */
  headingDeg: 0,

  /** Diagonal field of view of the "skylight", degrees. Bigger = wider sky, smaller = deeper well. */
  fovDeg: 80,

  weather: {
    pollMinutes: 15,
    retrySeconds: 60,
    /** How long new weather takes to ease in, seconds (time constant). */
    easeSeconds: 180,
    /** 10 m wind is slower than wind at cloud height. Multiply to get cloud drift speed. */
    cloudWindMultiplier: 2.2,
  },

  /** Soft darkening toward the screen edges, like looking up a skylight well. 0 = off. */
  vignette: 0.18,
  /** Draw the moon slightly larger than true size (it looks bigger to people than to cameras). */
  moonScale: 2.0,

  /** Light pollution, 0 = desert, 1 = Times Square. New York metro is roughly Bortle 8. */
  lightPollution: 0.8,

  quality: {
    high: { renderScale: 0.75, maxInternalWidth: 1920, cloudSteps: 72, lightSteps: 5, skySamples: 16, outputMaxWidth: 2560, cirrusStrands: 6000, noiseSize: 128 },
    medium: { renderScale: 0.35, maxInternalWidth: 640, cloudSteps: 24, lightSteps: 3, skySamples: 10, outputMaxWidth: 1280, cirrusStrands: 2400, noiseSize: 64 },
    low: { renderScale: 0.3, maxInternalWidth: 480, cloudSteps: 0, lightSteps: 0, skySamples: 8, outputMaxWidth: 960, cirrusStrands: 900, noiseSize: 64 },
  } satisfies Record<QualityName, QualityPreset>,

  defaultQuality: 'high' as QualityName,
  defaultMode: 'live' as ModeName,
  modeOrder: ['live', 'sunny', 'partly', 'clearNight', 'cloudyNight', 'golden', 'storm'] as ModeName[],

  /** Dynamic resolution: lower the sky's render size when FPS drops below target, raise it when above. */
  targetFps: { high: 55, medium: 28, low: 28 } as Record<QualityName, number>,

  brightness: { initial: 1.0, step: 0.1, min: 0.2, max: 1.6 },

  /**
   * Optional local control socket. On the Pi, a tiny script reading the rotary encoder
   * connects here and sends the same commands the keyboard does (e.g. "mode.next").
   * Enable with ?ws=1 or ?ws=ws://host:port in the URL, or set enabled true.
   */
  /** METAR relay (Vercel function in api/metar.js). Absolute URL lets a Pi use the deployed one. */
  metarUrl: '/api/metar',

  controlSocket: { enabled: false, url: 'ws://localhost:8787' },
};
