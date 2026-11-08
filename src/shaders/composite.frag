// Full-resolution composite: upscales the low-res sky, draws the moon crisply, and renders
// rain on the skylight glass (static droplets that land and evaporate, plus larger drops that
// slide along the glass's slope leaving clear trails). Original procedural implementation.
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSky;
uniform vec2 uResolution;
uniform float uTime;
uniform float uRain;        // current rain intensity 0..1 (new impacts)
uniform float uWet;         // how wet the glass is (lags rain; drops linger after rain stops)
uniform float uBrightness;
uniform float uVignette;
uniform vec3 uMoonDir;
uniform vec3 uSunDir;
uniform vec3 uMoonColor;    // lit-side moon color (display units, pre-brightness)
uniform float uMoonRadius;  // angular radius, radians
uniform float uPixelAngle;  // angular size of one output pixel, radians
uniform float uMoonGlowAmt; // aureole strength (moon brightness x night)
uniform vec3 uGlassTint;    // light picked up by the water film

// ---- static droplets: land at random times, sit, slowly shrink ----
// Returns xy: surface slope (for refraction), z: coverage mask.
vec3 staticDrops(vec2 p, float scale, float t, float seed, float clearMask) {
  vec2 q = p * scale;
  vec2 id = floor(q);
  vec2 f = fract(q) - 0.5;
  vec3 h = hash33(vec3(id, seed));
  float period = mix(16.0, 4.0, uRain) * (0.6 + 0.8 * h.z);
  float cyc = t / period + h.x;
  float ph = fract(cyc);
  vec3 h2 = hash33(vec3(id + 91.0 * floor(cyc), seed + 7.0));
  // Fewer cells hold a drop in light rain; drops born while it's raining persist while wet.
  float alive = step(h2.z, mix(0.15, 0.9, uRain) * smoothstep(0.0, 0.25, uWet));
  vec2 c = (h2.xy - 0.5) * 0.6;
  float r = mix(0.13, 0.36, h2.x * h2.y);
  r *= smoothstep(0.0, 0.015, ph) * (1.0 - 0.55 * ph) * mix(0.6, 1.0, uWet);
  vec2 d = f - c;
  d.y *= 1.0 + 0.15 * (h.y - 0.5);
  float dist = length(d) / max(r, 1e-3);
  if (dist >= 1.0 || alive < 0.5) return vec3(0.0);
  float hgt = sqrt(1.0 - dist * dist);
  vec2 slope = d / max(r, 1e-3) / max(hgt, 0.2);
  float m = smoothstep(1.0, 0.8, dist) * clearMask;
  return vec3(slope * m, m);
}

// ---- sliding drops: run down the glass's slope (screen -y), wobble, leave a trail ----
vec4 slidingDrops(vec2 p, float cols, float t, float seed) {
  vec2 q = vec2(p.x * cols, p.y);
  float id = floor(q.x);
  float fx = fract(q.x) - 0.5;
  vec3 h = hash33(vec3(id, seed, 3.0));
  float speed = mix(0.025, 0.07, h.y);
  float cyc = t * speed + h.x * 7.0;
  float cid = floor(cyc);
  float prog = fract(cyc);
  vec3 h2 = hash33(vec3(id, cid, seed));
  float isActive = step(h2.x, uRain * 0.85);
  // Stick-slip motion: mostly steady with small hesitations.
  float y = 1.25 - (prog + 0.012 * sin(prog * 37.0 + h.z * 6.0)) * 1.5;
  float wob = sin(p.y * 13.0 + h.z * 9.0) * 0.12 + sin(p.y * 31.0 + h.x * 5.0) * 0.05;
  float cw = 1.0 / cols;                // column width in p units
  float dx = (fx - wob - (h2.y - 0.5) * 0.3) * cw;
  float dy = p.y - y;
  float r = mix(0.012, 0.022, h2.z) * mix(0.7, 1.1, uRain);
  vec2 d = vec2(dx, dy * 0.75);
  float dist = length(d) / r;

  vec3 drop = vec3(0.0);
  if (dist < 1.0 && isActive > 0.5) {
    float hgt = sqrt(1.0 - dist * dist);
    drop.xy = d / r / max(hgt, 0.2);
    drop.z = smoothstep(1.0, 0.8, dist);
  }
  // Trail above the drop: a wiped band with a few tiny beads left behind.
  float trail = 0.0;
  if (isActive > 0.5 && dy > 0.0) {
    float fade = 1.0 - smoothstep(0.0, 0.45, dy);
    trail = smoothstep(r * 0.9, r * 0.4, abs(dx)) * fade;
    float by = dy * 55.0;
    float bid = floor(by);
    vec3 hb = hash33(vec3(id, bid, cid + seed));
    vec2 bd = vec2(dx + (hb.x - 0.5) * r * 0.6, (fract(by) - 0.5) / 55.0);
    float br = r * 0.32 * hb.y * fade;
    float bdist = length(bd) / max(br, 1e-4);
    if (bdist < 1.0 && hb.z > 0.45) {
      float bh = sqrt(1.0 - bdist * bdist);
      drop.xy += bd / max(br, 1e-4) / max(bh, 0.2) * 0.8;
      drop.z = max(drop.z, smoothstep(1.0, 0.7, bdist));
    }
  }
  return vec4(drop, trail);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash32(i).x, b = hash32(i + vec2(1.0, 0.0)).x;
  float c = hash32(i + vec2(0.0, 1.0)).x, d = hash32(i + vec2(1.0, 1.0)).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Shade one point on the moon's disk. s: position on the disk in moon radii.
// Returns lit color (rgb) and disk coverage (a).
vec4 moonShade(vec2 s, vec3 tx, vec3 ty) {
  float r2 = dot(s, s);
  if (r2 >= 1.0) return vec4(0.0);
  vec3 n = normalize(s.x * tx + s.y * ty - sqrt(1.0 - r2) * uMoonDir); // faces the viewer
  // Phase falls out of real geometry: the side facing the sun is lit. Soft terminator.
  float lit = smoothstep(-0.05, 0.16, dot(n, uSunDir));
  // Maria (the dark "seas"), laid out roughly like the real near side. Warp the lookup so
  // their outlines are irregular rather than circles.
  vec2 sw = s + (vec2(vnoise(s * 4.0 + 3.1), vnoise(s * 4.0 + 7.7)) - 0.5) * 0.22;
  float maria = 0.0;
  maria = max(maria, smoothstep(0.38, 0.18, length((sw - vec2(-0.55, 0.05)) * vec2(0.8, 1.0))) * 0.75); // Procellarum
  maria = max(maria, smoothstep(0.27, 0.12, length(sw - vec2(-0.3, 0.45))));                           // Imbrium
  maria = max(maria, smoothstep(0.17, 0.07, length(sw - vec2(0.08, 0.45))));                           // Serenitatis
  maria = max(maria, smoothstep(0.22, 0.09, length(sw - vec2(0.24, 0.15))));                           // Tranquillitatis
  maria = max(maria, smoothstep(0.12, 0.05, length(sw - vec2(0.64, 0.33))));                           // Crisium
  maria = max(maria, smoothstep(0.2, 0.08, length(sw - vec2(-0.2, -0.33))) * 0.8);                     // Nubium
  maria = max(maria, smoothstep(0.16, 0.06, length(sw - vec2(0.5, -0.08))) * 0.85);                    // Fecunditatis
  maria *= 0.75 + 0.5 * vnoise(s * 7.0);
  float albedo = mix(1.0, 0.5, saturate(maria));
  albedo *= 0.9 + 0.12 * vnoise(s * 18.0) + 0.06 * vnoise(s * 41.0);
  albedo += 0.35 * smoothstep(0.06, 0.0, length(s - vec2(-0.12, -0.72)));                             // Tycho
  float limb = 0.78 + 0.22 * sqrt(1.0 - r2);
  // Coverage follows the lit part, so the dark side melts into the sky (plus faint earthshine).
  // Premultiplied: coverage follows the lit part so the dark side melts into the sky,
  // apart from a faint earthshine.
  return vec4(uMoonColor * albedo * limb * lit + uMoonColor * 0.012, lit);
}

// Returns moon color (rgb) and coverage (a); the glow is added separately.
vec4 moon(vec3 rd, out vec3 glow) {
  float c = dot(rd, uMoonDir);
  float ang = acos(clamp(c, -1.0, 1.0));
  // Soft full-resolution aureole, scaled by how lit the moon is.
  float glowR = uMoonRadius * 4.0;
  glow = uMoonColor * uMoonGlowAmt * (0.08 * exp(-(ang * ang) / (glowR * glowR)) + 0.025 * exp(-ang / (glowR * 3.0)));
  if (ang > uMoonRadius * 1.5) return vec4(0.0);
  vec3 up = abs(uMoonDir.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 tx = normalize(cross(up, uMoonDir));
  vec3 ty = cross(uMoonDir, tx);
  float sr = sin(uMoonRadius);
  vec2 s = vec2(dot(rd, tx), dot(rd, ty)) / sr;
  // 4x4 supersampling across the pixel footprint: smooth limb and terminator at any size.
  float px = uPixelAngle / sr;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 4; i++)
    for (int j = 0; j < 4; j++)
      acc += moonShade(s + (vec2(float(i), float(j)) - 1.5) * 0.25 * px, tx, ty);
  return acc / 16.0;
}

void main() {
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = vUv * aspect;
  vec2 offset = vec2(0.0);
  float mask = 0.0;
  float trail = 0.0;
  float rim = 0.0;
  float lod = 0.0;

  if (uWet > 0.01) {
    vec4 s1 = slidingDrops(p, 9.0, uTime, 1.0);
    vec4 s2 = slidingDrops(p + vec2(0.37, 0.0), 14.0, uTime * 0.9, 2.0);
    trail = max(s1.w, s2.w);
    float clear = 1.0 - trail;
    vec3 a = staticDrops(p, 22.0, uTime, 11.0, clear);
    vec3 b = staticDrops(p + 0.31, 46.0, uTime * 1.1, 23.0, clear);
    vec3 c = staticDrops(p + 0.77, 90.0, uTime * 1.3, 37.0, clear);
    vec3 sum = a + b * 0.9 + c * 0.7 + vec3(s1.xy + s2.xy, 0.0);
    mask = saturate(a.z + b.z + c.z + s1.z + s2.z);
    offset = sum.xy;
    rim = mask * saturate(length(offset) * 0.35);
    // The thin water film between drops blurs the view slightly; trails are clearer.
    lod = uWet * 1.6 * (1.0 - trail * 0.8) * (1.0 - mask);
  }

  // Drops act as tiny lenses: the image through them is shrunk and inverted.
  vec2 uv = vUv - offset * vec2(1.0 / aspect.x, 1.0) * 0.022;
  vec4 sky = textureLod(uSky, uv, lod);
  vec3 col = sky.rgb;
  // Gentle unsharp mask: restores crispness lost when upscaling the reduced-resolution sky.
  vec3 soft = textureLod(uSky, uv, lod + 1.5).rgb;
  col = max(vec3(0.0), col + (col - soft) * 0.35 * (1.0 - saturate(lod)));

  vec3 rd = viewDir(vUv);
  // The moon covers the sky behind it (dimmed by any cloud in front); its glow adds on top.
  vec3 mglow;
  vec4 mn = moon(rd, mglow);
  col = col * (1.0 - mn.a * sky.a * 0.8) + (mn.rgb + mglow) * sky.a;

  if (uWet > 0.01) {
    col = mix(col, col * 0.55, rim * 0.6);                                  // dark refracting rims
    float spec = pow(saturate(dot(normalize(vec3(offset, 1.0)), normalize(vec3(-0.5, 0.6, 0.6)))), 24.0);
    col += uGlassTint * spec * mask * 0.5;                                   // highlight
    col = mix(col, col * 0.92 + uGlassTint * 0.06, uWet * (1.0 - trail));    // film
  }

  // Skylight well: very soft edge falloff.
  vec2 v = (vUv - 0.5) * 2.0;
  float vr = length(v * vec2(aspect.x, 1.0)) / length(vec2(aspect.x, 1.0)); // 0 center, 1 corners
  col *= 1.0 - uVignette * smoothstep(0.35, 1.0, vr);

  col *= uBrightness;
  col += (ign(gl_FragCoord.xy) - 0.5) / 255.0;                              // dither against banding
  outColor = vec4(col, 1.0);
}
