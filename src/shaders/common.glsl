// ---- shared helpers (prepended to every fragment shader) ----
precision highp float;
precision highp int;
precision highp sampler3D;

#define PI 3.14159265359

uniform vec2 uTanHalf;   // tan(half fov) in x and y
uniform mat3 uCamRot;    // local camera frame -> world ENU (handles ceiling heading)

// Screen uv (0..1) -> world view direction, looking straight up.
// Lying on your back with the top of the screen toward north, east is on your LEFT,
// so screen +x maps to world west. Sky viewed from below is mirror-imaged vs. a map.
vec3 viewDir(vec2 uv) {
  vec2 s = (uv * 2.0 - 1.0) * uTanHalf;
  return normalize(uCamRot * vec3(-s.x, s.y, 1.0));
}

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }
float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }

// PCG-style integer hash (Jarzynski & Olano, "Hash Functions for GPU Rendering", JCGT 2020).
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash33(vec3 p) { return vec3(pcg3d(uvec3(ivec3(floor(p)) + 32768))) * (1.0 / 4294967295.0); }
vec3 hash32(vec2 p) { return hash33(vec3(p, 17.0)); }

// Interleaved gradient noise (Jimenez 2014): cheap per-pixel dither / ray jitter.
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }

float hgPhase(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1e-4, 1.0 + g2 - 2.0 * g * c), 1.5));
}

// Reversible encoding so HDR radiance fits in an 8-bit texture without float extensions.
vec3 encodeHdr(vec3 c) { return c / (1.0 + c); }
vec3 decodeHdr(vec3 e) { return e / max(vec3(1e-4), 1.0 - e); }
