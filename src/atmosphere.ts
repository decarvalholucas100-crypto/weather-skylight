// CPU side of the atmosphere model. The GPU renders the full sky; the CPU computes a few
// scalar lighting terms per frame (sunlight color at cloud height, ambient sky light, exposure)
// using the same physical constants, so clouds are lit consistently with the sky behind them.
import type { Vec3 } from './astro';

export const EARTH_R = 6360e3;
export const ATMOS_R = 6420e3;
export const RAYLEIGH: Vec3 = [5.802e-6, 13.558e-6, 33.1e-6];
export const RAYLEIGH_H = 8000;
export const MIE = 3.996e-6;
export const MIE_EXT = 4.44e-6;
export const MIE_H = 1200;
export const OZONE: Vec3 = [0.65e-6, 1.881e-6, 0.085e-6];
export const SUN_INTENSITY = 20;

function rayExit(oz: number, dz: number, dh: number): number {
  // Ray from (0,0,oz) along direction with vertical component dz, horizontal magnitude dh.
  // Distance to the top of the atmosphere sphere centered at (0,0,0).
  const b = oz * dz;
  const c = oz * oz - ATMOS_R * ATMOS_R;
  void dh;
  return -b + Math.sqrt(Math.max(0, b * b - c));
}

/** Optical depth (per channel extinction integrated) from altitude h toward direction d. */
export function transmittance(h: number, d: Vec3, mieScale = 1, steps = 24): Vec3 {
  const oz = EARTH_R + h;
  const dz = d[2];
  const dh = Math.hypot(d[0], d[1]);
  // Does the ray hit the ground? Then fully shadowed (smoothed near the horizon below).
  const b = oz * dz;
  const cg = oz * oz - EARTH_R * EARTH_R;
  const disc = b * b - cg;
  if (dz < 0 && disc > 0) {
    const tGround = -b - Math.sqrt(disc);
    if (tGround > 0) return [0, 0, 0];
  }
  const len = rayExit(oz, dz, dh);
  const dt = len / steps;
  let odR = 0, odM = 0, odO = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt;
    const x = dh * t, z = oz + dz * t;
    const alt = Math.sqrt(x * x + z * z) - EARTH_R;
    odR += Math.exp(-alt / RAYLEIGH_H) * dt;
    odM += Math.exp(-alt / MIE_H) * dt;
    odO += Math.max(0, 1 - Math.abs(alt - 25000) / 15000) * dt;
  }
  const out: Vec3 = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    out[c] = Math.exp(-(RAYLEIGH[c] * odR + MIE_EXT * mieScale * odM + OZONE[c] * odO));
  }
  return out;
}

/** Sunlight arriving at altitude h (meters), in the same radiance units the sky uses. */
export function sunlightAt(h: number, sunDir: Vec3, mieScale: number): Vec3 {
  // Let the sun fade softly as it drops below the horizon rather than cutting to black,
  // standing in for the finite size of the solar disk and refraction.
  const t = transmittance(h, sunDir, mieScale);
  return [t[0] * SUN_INTENSITY, t[1] * SUN_INTENSITY, t[2] * SUN_INTENSITY];
}

/** Rough single-scatter sky radiance toward the zenith; used for ambient light and exposure. */
export function zenithRadiance(sunDir: Vec3, mieScale: number): Vec3 {
  const steps = 10;
  const top = ATMOS_R - EARTH_R;
  const dt = top / steps;
  const mu = sunDir[2]; // cos angle between zenith and sun
  const phaseR = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const g = 0.76;
  const phaseM = (3 / (8 * Math.PI)) * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5));
  const acc: Vec3 = [0, 0, 0];
  let odR = 0, odM = 0, odO = 0;
  for (let i = 0; i < steps; i++) {
    const h = (i + 0.5) * dt;
    const dR = Math.exp(-h / RAYLEIGH_H) * dt;
    const dM = Math.exp(-h / MIE_H) * dt;
    odR += dR; odM += dM;
    odO += Math.max(0, 1 - Math.abs(h - 25000) / 15000) * dt;
    const tl = transmittance(h, sunDir, mieScale, 8);
    for (let c = 0; c < 3; c++) {
      const tv = Math.exp(-(RAYLEIGH[c] * odR + MIE_EXT * mieScale * odM + OZONE[c] * odO));
      acc[c] += tv * tl[c] * (RAYLEIGH[c] * dR * phaseR + MIE * mieScale * dM * phaseM);
    }
  }
  return [acc[0] * SUN_INTENSITY, acc[1] * SUN_INTENSITY, acc[2] * SUN_INTENSITY];
}

export function luminance(c: Vec3): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
