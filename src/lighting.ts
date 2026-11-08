// Turns SkyParams into the lighting terms the shaders need. Physical terms (sun, sky) come
// from the atmosphere model and are scaled by an auto-exposure that mimics how your eyes adapt.
// Night terms (moonlight, city glow, starlight) are added in display units on top.
import { altOf, type Vec3 } from './astro';
import { luminance, sunlightAt, zenithRadiance } from './atmosphere';
import type { SkyParams } from './state';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const add = (...vs: Vec3[]): Vec3 => vs.reduce<Vec3>((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0]);
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export interface Lighting {
  exposure: number;
  mieScale: number;
  lightDir: Vec3;
  lightLow: Vec3;
  lightMid: Vec3;
  lightHigh: Vec3;
  ambTop: Vec3;
  ambBottom: Vec3;
  sunDisk: Vec3;
  nightSky: Vec3;
  moonGlow: Vec3;
  moonColor: Vec3;
  moonGlowAmt: number;
  fogColor: Vec3;
  glassTint: Vec3;
  starLimitMag: number;
  starVis: number;
  milkyWay: number;
  night: number;
  underDeck: number;
}

export function computeLighting(p: SkyParams): Lighting {
  const sunAlt = altOf(p.sunDir);
  const moonAlt = altOf(p.moonDir);
  const mieScale = 1 + p.haze * 8 + p.rain * 3;
  const lp = p.lightPollution;

  const zen = zenithRadiance(p.sunDir, mieScale);
  const zenL = luminance(zen);
  // Partial eye adaptation: twilight gets brighter than physical but still reads as dusk.
  const exposure = Math.min(1.1 / Math.pow(zenL + 1e-6, 0.78), 2500) * 0.3;

  const night = smooth(-4, -14, sunAlt); // 0 = day, 1 = full night
  const moonUp = smooth(-2, 8, moonAlt);
  const moonLightAmt = p.moonFraction * moonUp;

  // Overcast skies are much darker beneath: thick decks absorb most light.
  const deck = Math.max(0, p.cloudLow - 0.6) / 0.4;
  const dim = 1 - 0.45 * deck * (0.4 + 0.6 * p.storminess);
  // A mid-level deck (altostratus) sits above the low clouds and blocks the direct sun from
  // reaching them: low clouds under it turn gray instead of sunlit white.
  const underDeckG = 1 - 0.85 * Math.min(1, Math.max(0, (p.cloudMid - 0.4) / 0.5));
  const midDeck = Math.max(0, (p.cloudMid - 0.55) / 0.45);
  const md = Math.min(1, Math.max(0, (p.cloudMid - 0.4) / 0.5));
  const underDeck = 1 - 0.9 * md * md * (3 - 2 * md) - 0.25 * Math.max(0, p.cloudHigh - 0.6);
  void midDeck;

  // Direct sunlight on clouds adapts less than the sky does, so low-sun clouds stay orange
  // instead of blowing out to yellow-white.
  const sunExp = Math.min(exposure, 2.4);
  const sunLow = scale(sunlightAt(p.lowBase + 400, p.sunDir, mieScale), sunExp * dim * underDeck);
  const sunMid = scale(sunlightAt(4600, p.sunDir, mieScale), sunExp);
  const sunHigh = scale(sunlightAt(9000, p.sunDir, mieScale), Math.min(exposure, 6));

  // Moonlight takes over as the cloud light source once the sun is well below the horizon.
  const moonW = smooth(-5, -10, sunAlt) * moonLightAmt;
  const moonLight: Vec3 = scale([0.55, 0.6, 0.72], 0.32 * moonW);
  const useMoon = sunAlt < -5;
  const lightDir = useMoon ? p.moonDir : p.sunDir;

  // City light (sodium + LED mix): warm orange-pink, reflected by cloud bases.
  const cityGlow: Vec3 = scale([0.86, 0.6, 0.47], lp * night);

  // Under a thick deck, skylight turns gray (no blue sky visible above the clouds).
  const zl = luminance(zen);
  const zenGray = mix(zen, [zl, zl, zl * 1.05], Math.min(1, deck * 0.9 + p.rain * 0.5));
  const ambTopDay = scale(zenGray, exposure * 1.7 * dim);
  const ambTop = add(ambTopDay, scale([0.05, 0.07, 0.12], night * (0.25 + moonLightAmt)), scale(cityGlow, 0.03));
  const groundBounce = scale(sunlightAt(20, p.sunDir, mieScale), exposure * Math.max(0, p.sunDir[2]) * 0.012 * dim * (0.3 + 0.7 * underDeckG));
  // Overcast light is neutral-to-cool; strip the warm ground-bounce tint under a deck.
  const gb = luminance(groundBounce);
  const ambBottom = add(mix(groundBounce, [gb * 0.95, gb, gb * 1.08], deck), scale(ambTopDay, 0.18), scale(cityGlow, 0.17 * (0.6 + 0.4 * p.cloudLow)));

  const nightSky = add(
    scale([0.004, 0.007, 0.018], night),
    scale([0.022, 0.017, 0.018], lp * night), // skyglow
    scale([0.008, 0.013, 0.028], night * moonLightAmt), // moonlit sky turns deep blue
  );

  const sunGround = sunlightAt(20, p.sunDir, mieScale);
  const sunDisk = scale(sunGround, exposure * 60 * (1 - 0.7 * deck));

  // Keep the moon under display white so its surface detail survives (no clipping).
  const moonColor: Vec3 = scale([1.0, 0.97, 0.9], 0.35 + 0.42 * night);
  const moonGlowAmt = moonLightAmt * night * (1 + p.haze * 2);
  const moonGlow = scale([0.6, 0.65, 0.8], 0.05 * moonLightAmt * night * (1 + p.haze * 3));

  const fogColor0 = mix(scale(ambTop, 0.6 * (1 - 0.35 * p.storminess)), add(scale(ambBottom, 1.2), scale(cityGlow, 0.05)), 0.3 * (1 - p.storminess * 0.6));
  const fl = luminance(fogColor0);
  const fogColor = mix(fogColor0, [fl * 0.9, fl * 0.97, fl * 1.1], Math.min(1, deck * 0.7 + p.storminess * 0.5) * (1 - night));
  const glassTint = add(scale(ambTop, 0.6), scale(cityGlow, 0.05), [0.02, 0.02, 0.025]);

  // Stars: NYC washes out all but the brightest. Moon, haze and twilight dim further.
  const starLimitMag = 6.4 - 2.8 * lp - 1.2 * moonLightAmt - 2.5 * p.haze - 3 * (1 - smooth(-8, -16, sunAlt));
  const starVis = smooth(-4, -11, sunAlt);

  return {
    exposure, mieScale, lightDir,
    lightLow: add(sunLow, moonLight), lightMid: add(sunMid, moonLight), lightHigh: add(sunHigh, scale(moonLight, 1.2)),
    ambTop, ambBottom, sunDisk, nightSky, moonGlow, moonColor, moonGlowAmt, fogColor, glassTint,
    starLimitMag, starVis, night, underDeck,
    // Visible only under genuinely dark skies, with little moonlight.
    milkyWay: starVis * Math.pow(Math.max(0, 1 - lp / 0.55), 2) * (1 - 0.8 * moonLightAmt) * (1 - p.haze),
  };
}
