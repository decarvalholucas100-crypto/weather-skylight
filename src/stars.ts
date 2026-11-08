// Star field for the night sky.
import { STAR_CATALOG } from './data/stars6';

/** Pack stars into a vertex buffer: [eqX, eqY, eqZ, mag, bv] per star. Real Hipparcos-derived
 * catalog (5,000+ stars to magnitude 6): every star you'd see under a truly dark sky, in its real
 * position. Light pollution decides how many actually show. */
export function buildStarBuffer(): { data: Float32Array; count: number } {
  const n = STAR_CATALOG.length / 4;
  const out = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) {
    const ra = (STAR_CATALOG[i * 4] * Math.PI) / 180;
    const dec = (STAR_CATALOG[i * 4 + 1] * Math.PI) / 180;
    out.set([Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec), STAR_CATALOG[i * 4 + 2], STAR_CATALOG[i * 4 + 3]], i * 5);
  }
  return { data: out, count: n };
}
