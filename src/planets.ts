// Naked-eye planets from JPL's approximate Keplerian elements (Standish, "Approximate Positions
// of the Planets", valid 1800-2050, public domain). Accurate to well under a degree: plenty
// for a display. Output is a unit vector in equatorial coordinates, like the star catalog.

type Elements = [number, number, number, number, number, number]; // a, e, I, L, longPeri, longNode
interface Planet { name: string; el: Elements; rate: Elements; H: number; bv: number }

const PLANETS: Planet[] = [
  { name: 'Venus', el: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], rate: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418], H: -4.4, bv: 0.82 },
  { name: 'Mars', el: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343], H: -1.52, bv: 1.36 },
  { name: 'Jupiter', el: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106], H: -9.4, bv: 0.83 },
  { name: 'Saturn', el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], rate: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794], H: -8.88, bv: 1.04 },
];
const EARTH: Omit<Planet, 'name' | 'H' | 'bv'> = {
  el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
  rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
};

const D = Math.PI / 180;

function helio(el: Elements, rate: Elements, T: number): [number, number, number] {
  const [a, e, I, L, wbar, node] = el.map((v, i) => v + rate[i] * T) as Elements;
  const M = (((L - wbar) % 360) + 540) % 360 - 180;
  const w = (wbar - node) * D, O = node * D, inc = I * D;
  let E = M * D + e * Math.sin(M * D);
  for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M * D) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(inc), sI = Math.sin(inc);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** Per planet: [eqX, eqY, eqZ, magnitude, B-V], same layout as the star buffer. */
export function planetRows(date: Date): number[] {
  const T = (date.getTime() / 86400000 + 2440587.5 - 2451545) / 36525;
  const earth = helio(EARTH.el, EARTH.rate, T);
  const eps = 23.43928 * D;
  const rows: number[] = [];
  for (const p of PLANETS) {
    const h = helio(p.el, p.rate, T);
    const g = [h[0] - earth[0], h[1] - earth[1], h[2] - earth[2]];
    const dist = Math.hypot(g[0], g[1], g[2]);
    const r = Math.hypot(h[0], h[1], h[2]);
    const x = g[0] / dist, y = g[1] / dist, z = g[2] / dist;
    // Ecliptic -> equatorial
    const eq = [x, y * Math.cos(eps) - z * Math.sin(eps), y * Math.sin(eps) + z * Math.cos(eps)];
    // Phase angle (Sun-planet-Earth): a crescent Venus is far dimmer than its distance implies.
    const R = Math.hypot(earth[0], earth[1], earth[2]);
    const iDeg = Math.acos(Math.max(-1, Math.min(1, (r * r + dist * dist - R * R) / (2 * r * dist)))) / D;
    const phase = p.name === 'Venus' ? 0.0009 * iDeg + 0.000239 * iDeg ** 2 - 6.5e-7 * iDeg ** 3
      : p.name === 'Mars' ? 0.016 * iDeg : p.name === 'Jupiter' ? 0.005 * iDeg : 0.044 * iDeg / 6;
    const mag = Math.max(-4.9, p.H + 5 * Math.log10(r * dist) + phase);
    rows.push(eq[0], eq[1], eq[2], mag, p.bv);
  }
  return rows;
}

export const PLANET_COUNT = PLANETS.length;
