// Tileable 3D noise volume for clouds, generated once at startup.
// R: Perlin-Worley (billowy base shape). G, B, A: Worley at rising frequencies (erosion detail).
// Written from scratch from the standard published techniques (Perlin 1985/2002, Worley 1996,
// Schneider "Real-time volumetric cloudscapes", GPU Pro 7). No third-party code.

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Worley (cellular) noise with `cells` cells per axis, tiling over the unit cube. Returns 1 - F1 distance. */
function worleyField(N: number, cells: number, seed: number): Float32Array {
  const rnd = makeRng(seed);
  const pts = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rnd();
  const out = new Float32Array(N * N * N);
  const inv = cells / N;
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const px = (x + 0.5) * inv, py = (y + 0.5) * inv, pz = (z + 0.5) * inv;
        const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
        let best = 9;
        for (let dz = -1; dz <= 1; dz++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const ix = cx + dx, iy = cy + dy, iz = cz + dz;
              const wx = ((ix % cells) + cells) % cells;
              const wy = ((iy % cells) + cells) % cells;
              const wz = ((iz % cells) + cells) % cells;
              const k = ((wz * cells + wy) * cells + wx) * 3;
              const fx = ix + pts[k] - px, fy = iy + pts[k + 1] - py, fz = iz + pts[k + 2] - pz;
              const d = fx * fx + fy * fy + fz * fz;
              if (d < best) best = d;
            }
        out[(z * N + y) * N + x] = 1 - Math.min(1, Math.sqrt(best));
      }
  return out;
}

/** Tileable gradient (Perlin) noise with `period` lattice cells per axis. Output roughly -1..1. */
function perlinField(N: number, period: number, seed: number): Float32Array {
  const rnd = makeRng(seed);
  const grads = new Float32Array(period * period * period * 3);
  for (let i = 0; i < period * period * period; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    grads[i * 3] = r * Math.cos(th); grads[i * 3 + 1] = r * Math.sin(th); grads[i * 3 + 2] = u;
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const out = new Float32Array(N * N * N);
  const inv = period / N;
  for (let z = 0; z < N; z++)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const px = x * inv, py = y * inv, pz = z * inv;
        const x0 = Math.floor(px), y0 = Math.floor(py), z0 = Math.floor(pz);
        const fx = px - x0, fy = py - y0, fz = pz - z0;
        let acc = 0;
        for (let c = 0; c < 8; c++) {
          const ox = c & 1, oy = (c >> 1) & 1, oz = (c >> 2) & 1;
          const gx = (x0 + ox) % period, gy = (y0 + oy) % period, gz = (z0 + oz) % period;
          const g = ((gz * period + gy) * period + gx) * 3;
          const dx = fx - ox, dy = fy - oy, dz = fz - oz;
          const dot = grads[g] * dx + grads[g + 1] * dy + grads[g + 2] * dz;
          const w = (ox ? fade(fx) : 1 - fade(fx)) * (oy ? fade(fy) : 1 - fade(fy)) * (oz ? fade(fz) : 1 - fade(fz));
          acc += dot * w;
        }
        out[(z * N + y) * N + x] = acc;
      }
  return out;
}

function remap(v: number, a: number, b: number, c: number, d: number): number {
  return c + ((v - a) / (b - a)) * (d - c);
}

export function generateCloudNoise(N = 64): Float32Array {
  const p1 = perlinField(N, 4, 11), p2 = perlinField(N, 8, 12), p3 = perlinField(N, 16, 13);
  const w1 = worleyField(N, 4, 21), w2 = worleyField(N, 8, 22), w3 = worleyField(N, 16, 23), w4 = worleyField(N, 32, 24);
  // Float output: 8-bit noise shows up as contour bands once thick clouds amplify it.
  const out = new Float32Array(N * N * N * 4);
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  for (let i = 0; i < N * N * N; i++) {
    const perlin = clamp01((p1[i] + 0.5 * p2[i] + 0.25 * p3[i]) * 0.75 + 0.5);
    const worleyFbm = w1[i] * 0.625 + w2[i] * 0.25 + w3[i] * 0.125;
    const pw = clamp01(remap(perlin, worleyFbm - 1, 1, 0, 1)); // Perlin-Worley
    out[i * 4] = pw;
    out[i * 4 + 1] = clamp01(w2[i] * 0.625 + w3[i] * 0.25 + w4[i] * 0.125);
    out[i * 4 + 2] = clamp01(w3[i] * 0.75 + w4[i] * 0.25);
    out[i * 4 + 3] = clamp01(perlin);
  }
  return out;
}
