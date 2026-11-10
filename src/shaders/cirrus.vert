#version 300 es
// Strand-based cirrus. Each instance is one fall streak: a thin ribbon at ~9 km, stretched by
// wind shear. Strands come in clustered bundles that share direction and curvature, which is
// what gives real cirrus its combed, fibrous look. Positions are computed here, from hashes and
// a low-frequency flow field, so there is no geometry buffer and nothing repeats.
precision highp float;
precision highp int;

uniform mat3 uCamRot;
uniform vec2 uTanHalf;
uniform vec2 uWindHigh;      // accumulated drift (m)
uniform vec2 uWindDir;       // unit vector the wind blows toward
uniform float uCover;        // high cloud cover 0..1
uniform float uTime;
uniform vec2 uPixel;         // size of one target pixel in clip units (x, y)
uniform int uSegments;       // segments per strand

out float vAcross;           // -1..1 across the ribbon
out float vAlong;            // 0..1 head to tail
out float vAlpha;
out vec3 vDir;               // world view direction (for lighting)
out float vSeed;

const float H = 9000.0;      // cirrus altitude
const float TILE = 26000.0;  // strands wrap around the viewer inside this square

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash3(float a, float b) { return vec3(pcg3d(uvec3(uint(a) + 911u, uint(b) + 77u, 1013u))) * (1.0 / 4294967295.0); }
vec2 g2(vec2 i) { float a = float(pcg3d(uvec3(ivec3(ivec2(floor(i)), 5) + 32768)).x) * (6.2831853 / 4294967295.0); return vec2(cos(a), sin(a)); }
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(g2(i), f), b = dot(g2(i + vec2(1, 0)), f - vec2(1, 0));
  float c = dot(g2(i + vec2(0, 1)), f - vec2(0, 1)), d = dot(g2(i + vec2(1, 1)), f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4 + 0.5;
}

vec2 project(vec3 world) {
  vec3 l = transpose(uCamRot) * world;
  return vec2(-l.x, l.y) / l.z / uTanHalf;
}

void main() {
  float id = float(gl_InstanceID);
  float cluster = floor(id / 40.0);
  vec3 hc = hash3(cluster, 0.0);
  vec3 hs = hash3(id, 1.0);
  vec3 hs2 = hash3(id, 2.0);

  vec2 perp = vec2(-uWindDir.y, uWindDir.x);

  // Cluster centre, wrapped around the viewer as the wind carries the whole field along.
  vec2 centre = (hc.xy - 0.5) * TILE;
  vec2 rel = centre - uWindHigh;
  rel = mod(rel + TILE * 0.5, TILE) - TILE * 0.5;

  // Where cirrus exists: large patches (same field for the whole cluster, in fixed world space).
  vec2 anchor = rel + uWindHigh;
  float patchN = gnoise(anchor / 21000.0 + 3.1) * 0.65 + gnoise(anchor / 8000.0 + 7.7) * 0.35;
  float th = 0.8 - uCover * 0.62; // sparse at low cover, common only when high cover is real
  float patchM = smoothstep(th, th + 0.16, patchN);

  // Bundle direction: wind direction plus a slowly varying flow angle shared by the cluster.
  // Streak direction drifts only gently across the sky (real cirrus bands run nearly parallel);
  // a strongly varying field makes streaks cross and pile into a bright fan.
  float flow = (gnoise(anchor / 40000.0) - 0.5) * 0.35 + (hc.z - 0.5) * 0.18;
  float ca = cos(flow), sa = sin(flow);
  vec2 dir = vec2(ca * uWindDir.x - sa * uWindDir.y, sa * uWindDir.x + ca * uWindDir.y);
  vec2 side = vec2(-dir.y, dir.x);

  // Strand within its bundle: offset across and along, similar length, own curvature.
  float L = mix(1800.0, 7500.0, hc.x * hc.x) * mix(0.55, 1.15, hs.x);
  // Strands overlap heavily inside a bundle (a Gaussian-ish spread), so they merge into a wisp.
  float spread = (hs.y + hs2.x - 1.0) * mix(700.0, 2200.0, hc.y);
  vec2 origin = rel + side * spread + dir * (hs.z - 0.5) * L * 0.6;
  // Strands in a bundle run nearly parallel (shared hook), with only slight individual bend.
  float curve = (hc.z - 0.5) * 0.6 + (hs2.x - 0.5) * 0.06;
  float widthM = mix(60.0, 260.0, hs2.y * hs2.y) * mix(0.8, 1.3, hc.y);

  int seg = gl_VertexID / 2;
  float sideSign = (gl_VertexID % 2 == 0) ? -1.0 : 1.0;
  float t = float(seg) / float(uSegments);

  // Centreline: straight along dir, bending quadratically (shear), plus gentle waviness.
  vec2 P = origin + dir * (t * L) + side * (curve * t * t * L * 0.35)
         + side * (gnoise(vec2(t * 2.5 + hs.x * 10.0, id * 0.37)) - 0.5) * 120.0;
  float t2 = min(1.0, t + 0.02);
  vec2 P2 = origin + dir * (t2 * L) + side * (curve * t2 * t2 * L * 0.35)
          + side * (gnoise(vec2(t2 * 2.5 + hs.x * 10.0, id * 0.37)) - 0.5) * 120.0;
  vec2 tang = normalize(P2 - P + dir * 1e-3);
  vec2 nrm = vec2(-tang.y, tang.x);

  // Denser hooked head, thin fading tail.
  float w = widthM * mix(1.6, 0.45, t);
  vec3 wc = vec3(P, H);
  vec2 sc = project(wc);
  // Keep ribbons at least ~1.6 px wide so they never shimmer at low resolution.
  vec2 sn = project(wc + vec3(nrm * w, 0.0)) - sc;
  float len = length(sn / uPixel);
  float grow = max(1.0, 1.6 / max(len, 1e-3));
  vec2 offs = sn * grow * sideSign;

  float alongA = smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.55, t) * (1.0 - 0.4 * t);
  // Coverage conservation: a bundle's ~40 strands spread over 'bundleM' metres across the wind.
  // Where perspective packs that width into fewer pixels than the strands need, they overlap and
  // would stack to solid white, so scale each strand's opacity by the available width. The
  // bundle's total optical depth then stays the same from any angle, like a real ice sheet.
  float bundleM = mix(700.0, 2200.0, hc.y) * 2.0;
  vec2 sb = project(wc + vec3(side * bundleM, 0.0)) - sc;
  float bundlePx = length(sb / uPixel);
  float needPx = 40.0 * max(len, 1.6) * 0.5;      // strands can overlap ~2x before it shows
  float packing = clamp(bundlePx / max(needPx, 1.0), 0.15, 1.0);
  float shimmer = 0.85 + 0.15 * sin(uTime * 0.05 + hs.x * 40.0);
  // Bundle edges fade: strands far from the bundle's centre line are fainter.
  float edge = 1.0 - smoothstep(0.25, 0.9, abs(hs.y + hs2.x - 1.0));
  vAlpha = patchM * alongA * mix(0.3, 1.0, hs2.z) * edge * shimmer * packing / grow;
  vAcross = sideSign;
  vAlong = t;
  vDir = normalize(wc);
  vSeed = hs.x;

  vec3 lc = transpose(uCamRot) * wc;
  if (patchM < 0.002 || lc.z <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = vec4(sc + offs, 0.0, 1.0);
}
