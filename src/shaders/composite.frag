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

vec3 moon(vec3 rd) {
  float c = dot(rd, uMoonDir);
  float ang = acos(clamp(c, -1.0, 1.0));
  if (ang > uMoonRadius * 1.6) return vec3(0.0);
  // Build a tangent frame around the moon direction and reconstruct the sphere normal.
  vec3 up = abs(uMoonDir.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 tx = normalize(cross(up, uMoonDir));
  vec3 ty = cross(uMoonDir, tx);
  vec2 s = vec2(dot(rd, tx), dot(rd, ty)) / sin(uMoonRadius);
  float r2 = dot(s, s);
  float edge = smoothstep(1.0, 0.94, sqrt(r2));
  if (r2 >= 1.0) return vec3(0.0);
  vec3 n = normalize(s.x * tx + s.y * ty - sqrt(1.0 - r2) * uMoonDir); // faces the viewer
  // Phase falls out of real geometry: the side facing the sun is lit.
  float lit = smoothstep(-0.04, 0.12, dot(n, uSunDir));
  // Maria: low-frequency dark patches, fixed to the moon's face.
  vec2 m = s * 2.2;
  float maria = 0.0;
  maria += smoothstep(0.55, 0.15, length(m - vec2(-0.45, 0.55))) * 0.35;
  maria += smoothstep(0.65, 0.2, length(m - vec2(0.35, 0.35))) * 0.3;
  maria += smoothstep(0.5, 0.1, length(m - vec2(0.1, -0.5))) * 0.25;
  maria += smoothstep(0.45, 0.1, length(m - vec2(-0.6, -0.3))) * 0.2;
  float tex = 1.0 - maria + (hash32(floor(s * 40.0)).x - 0.5) * 0.06;
  float limb = 0.75 + 0.25 * sqrt(1.0 - r2);
  vec3 earthshine = uMoonColor * 0.012;
  return (uMoonColor * lit * tex * limb + earthshine) * edge;
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

  vec3 rd = viewDir(vUv);
  col += moon(rd) * sky.a;

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
