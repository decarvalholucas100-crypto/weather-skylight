// Main sky pass, rendered at reduced resolution: atmosphere + sun + three cloud layers.
// Low layer: raymarched volumetric clouds (Beer-Lambert extinction, Henyey-Greenstein phase,
// multi-octave multiple-scattering approximation after Wrenninge 2013 / Hillaire 2016).
// Mid and high layers: lit 2D sheets (altocumulus, cirrus).
// Output: tonemapped color in rgb, total cloud/haze transmittance in alpha (used to dim
// stars and the moon drawn later at full resolution).
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSkyLut;
uniform sampler3D uNoise;

uniform vec3 uSunDir;
uniform vec3 uLightDir;      // main light for clouds (sun by day, moon by night)
uniform vec3 uLightLow;      // light color reaching the low layer (exposed units)
uniform vec3 uLightMid;
uniform vec3 uLightHigh;
uniform vec3 uAmbTop;        // sky light from above
uniform vec3 uAmbBottom;     // ground bounce + city glow from below
uniform vec3 uSunDisk;       // sun disk radiance (exposed)
uniform vec3 uNightSky;      // added night-sky base color (display units)
uniform vec3 uMoonDir;
uniform vec3 uMoonGlow;
uniform vec3 uFogColor;

uniform float uCoverLow, uCoverMid, uCoverHigh;
uniform float uStorm;
uniform float uLowBase;      // m, low cloud base (METAR)
uniform float uConvective;   // 0 stratus .. 1 cumulus
uniform float uTowers;       // towering cumulus / cumulonimbus amount
uniform float uScud;         // amount of low scud under storm / rain bases
uniform float uUnderDeck;    // 1 = open sky above the low layer, ~0.1 = under a thick mid deck
uniform float uRain;
uniform float uHaze;
uniform float uTime;
uniform vec2 uWindLow;       // accumulated drift offsets (meters)
uniform vec2 uWindMid;
uniform vec2 uWindHigh;
uniform vec2 uWindDir;       // unit vector clouds move toward
uniform float uFlash;        // lightning, 0..1
uniform vec2 uFlashPos;      // world xy at cloud height
uniform vec2 uResolution;
uniform sampler2D uCirrus;   // strand cirrus (premultiplied), same resolution as this pass
uniform sampler2D uPrev;     // previous frame, for temporal accumulation
uniform float uHistory;      // 0 = no history, ~0.85 = smooth
uniform float uFrame;

// ---------- sky ----------
vec3 skyRadiance(vec3 d) {
  float theta = acos(clamp(d.z, 0.0, 1.0));
  vec2 hd = normalize(d.xy + vec2(1e-6));
  vec2 uv = hd * (theta / (PI * 0.5)) * 0.5 + 0.5;
  return decodeHdr(texture(uSkyLut, uv).rgb);
}

// ---------- low cloud layer ----------
float layerBase() { return mix(uLowBase, min(uLowBase, 800.0), uStorm); }
// Thickness of ordinary cloud (stratus thin, cumulus deep, storms deeper)...
float baseThick() { return mix(mix(650.0, 1900.0, uConvective), 3000.0, uStorm); }
// ...plus headroom for towers (TCU / CB) that rise far above the rest.
float layerThick() { return baseThick() + uTowers * 3200.0; }

float coverageAt(vec2 xz) {
  vec2 w = xz + uWindLow;
  float wm = texture(uNoise, vec3(w / 19200.0, 0.13)).a * 0.6 + texture(uNoise, vec3(w / 6400.0, 0.57)).a * 0.4;
  float c = pow(uCoverLow, 1.4);
  float cov = saturate(c + (wm - 0.5) * 1.6 * (1.0 - c * c));
  return cov * smoothstep(0.0, 0.12, c);
}

// hf: 0..1 through the full layer (including tower headroom). towerMask: where towers rise.
float heightProfile(float hf, float towerMask) {
  float frac = baseThick() / layerThick();        // ordinary cloud occupies the bottom 'frac'
  float hb = hf / frac;                            // height in ordinary-cloud units
  float tall = mix(frac, 1.0, towerMask);          // towers reach the top of the layer
  // Cumulus: flat base, rounded top. Stratus: thin uniform sheet.
  float cumulus = smoothstep(0.0, 0.07, hb) * smoothstep(frac, frac * 0.5, hf);
  float stratus = smoothstep(0.0, 0.15, hb) * smoothstep(frac, frac * 0.7, hf);
  float flat_ = max(saturate(1.25 - uConvective * 1.7), saturate(uCoverLow * 1.2 - 0.3 + uStorm * 0.5) * (1.0 - uConvective * 0.6));
  float body = mix(cumulus, stratus, saturate(flat_));
  // Towers are stacked on top of the ordinary layer, so the base stays continuous (no seams).
  float tower = smoothstep(0.0, 0.07, hb) * smoothstep(tall, tall * 0.45, hf) * step(0.01, towerMask);
  return max(body, tower * towerMask);
}

float cloudDensity(vec3 p, float hf, bool detail) {
  float cov = coverageAt(p.xy);
  if (cov < 0.01) return 0.0;
  vec3 q = vec3(p.xy + uWindLow, p.z) ;
  float evolve = uTime * 0.0008; // uTime wraps every 1250 s; keeps noise periodic
  // Two scales of billows: big cloud masses plus smaller lumps riding on them.
  float base = texture(uNoise, q / 1600.0 + vec3(0.0, 0.0, evolve)).r * 0.72
             + texture(uNoise, q / 640.0 + vec3(0.37, 0.11, evolve * 2.0)).r * 0.28;
  base = saturate(remap(base, 0.08, 0.92, 0.0, 1.0));
  // Overcast decks: an undulating base gives the rolling light/dark texture of a stratus ceiling.
  float deckness = saturate(uCoverLow * 1.5 - 0.6 + uStorm * 0.5);
  float undulate = texture(uNoise, vec3(q.xy / 4000.0, 0.9 + evolve)).a - 0.5;
  hf = hf - undulate * 0.35 * deckness;
  // Stratus decks get lumpy, rolling texture on their underside (stratocumulus-like rolls).
  float rolls = texture(uNoise, vec3(q.xy / vec2(1500.0, 2600.0), 0.62 + evolve)).a;
  base = mix(base, base * (0.6 + 0.8 * rolls), deckness * 0.7);
  float towerMask = uTowers > 0.01 ? smoothstep(0.5, 0.78, texture(uNoise, vec3(q.xy / 7000.0, 0.37)).a) * uTowers : 0.0;
  float shape = base * heightProfile(hf, towerMask);
  float d = saturate(remap(shape, 1.0 - cov, 1.0, 0.0, 1.0));
  if (d <= 0.0) return 0.0;
  if (detail) {
    // Domain-warped detail: swirls the erosion noise so edges turn wispy instead of blobby.
    vec3 dq = q / 320.0 + vec3(0.0, 0.0, evolve * 3.0);
    vec3 warp = texture(uNoise, q / 900.0 + vec3(0.5, 0.0, evolve)).rga - 0.5;
    dq += warp * 0.35;
    vec3 dn = texture(uNoise, dq).gba;
    float df = dn.x * 0.625 + dn.y * 0.25 + dn.z * 0.125;
    float fine = texture(uNoise, dq * 3.0).g;
    df = df * 0.8 + fine * 0.2;
    // Wispy at the bottom, billowy (cauliflower) toward the top; erosion bites edges, not cores.
    float erode = mix(df, 1.0 - df, saturate(hf * 4.0));
    d = saturate(remap(d, erode * 0.45 * (1.0 - d * 0.5), 1.0, 0.0, 1.0));
  }
  d *= smoothstep(0.0, 0.25, d); // fade out tiny fragments instead of hard specks
  return d * mix(1.8, 2.6, cov) * mix(1.0, 1.4, uStorm);
}

vec4 marchLow(vec3 rd, float jitter) {
  float base = layerBase();
  float top = base + layerThick();
  float t0 = base / rd.z;
  float t1 = top / rd.z;
  float steps = float(CLOUD_STEPS);
  float dt = (t1 - t0) / steps;
  float t = t0 + dt * jitter;

  float cosA = dot(rd, uLightDir);
  float sigma = mix(0.05, 0.065, uStorm);
  float thick = top - base;

  vec3 L = vec3(0.0);
  float T = 1.0;
  for (int i = 0; i < CLOUD_STEPS; i++) {
    vec3 p = rd * t;
    float hf = (p.z - base) / thick;
    float d = cloudDensity(p, hf, true);
    if (d > 0.002) {
      // Light march toward the sun/moon for self-shadowing.
      float od = 0.0;
      // Exponentially growing steps: fine detail near the sample, coarse far away.
      float ls = 24.0 * (6.0 / float(LIGHT_STEPS + 1));
      float lt = ls * jitter;
      for (int j = 0; j < LIGHT_STEPS; j++) {
        vec3 lp = p + uLightDir * (lt + ls * 0.5);
        float lhf = (lp.z - base) / thick;
        if (lhf > 1.0) break;
        od += cloudDensity(lp, lhf, false) * ls;
        lt += ls;
        ls *= 1.9;
      }
      // The light march stops ~1 km out; under a solid deck or storm the rest of the cloud
      // above still blocks the sun. Add an estimate for that remainder so light can't leak.
      float endZ = p.z + uLightDir.z * lt;
      float remain = max(0.0, top - endZ) / max(uLightDir.z, 0.15);
      od += remain * 0.3 * uCoverLow * uCoverLow * (0.4 + 0.6 * uStorm);
      od *= sigma;
      // Multiple-scattering octaves: each octave scatters less, attenuates less, and is more isotropic.
      vec3 direct = vec3(0.0);
      float a = 1.0, b = 1.0, c = 1.0;
      for (int k = 0; k < 3; k++) {
        float ph = mix(hgPhase(cosA, 0.8 * c), hgPhase(cosA, -0.25 * c), 0.25);
        direct += a * ph * exp(-od * b);
        a *= 0.6; b *= 0.5; c *= 0.5;
      }
      // Powder term: darkens thin edges that face away from the light ("dark centers, bright rims" from below).
      float powder = 1.0 - exp(-od * 2.0 - d * 0.5);
      direct *= mix(1.0, powder * 2.0, 0.35);
      // Ambient occlusion from the cloud mass directly overhead: the base of a thick cloud is
      // dark, thin edges and wisps stay bright. This is what makes clouds read correctly from
      // below whatever the sun angle (a low sun alone would only shade their sides).
      float odUp = 0.0;
      float us = thick * 0.08;
      float ut = us * (0.5 + jitter);
      for (int k = 0; k < 3; k++) {
        vec3 up = p + vec3(0.0, 0.0, ut);
        float uhf = (up.z - base) / thick;
        if (uhf > 1.0) break;
        odUp += cloudDensity(up, uhf, false) * us;
        ut += us; us *= 2.2;
      }
      odUp *= sigma;
      float occl = exp(-odUp * 0.22);
      vec3 amb = uAmbTop * mix(0.45, 1.0, uUnderDeck) * mix(0.22, 1.0, occl) * mix(0.75, 1.0, saturate(hf)) + uAmbBottom * (0.85 + 0.3 * (1.0 - occl));
      // A low sun skims under cloud bases; keep its self-shadowing from reading as dark smudges.
      float lowSun = 1.0 - saturate(uLightDir.z * 4.0);
      direct = mix(direct, max(direct, vec3(hgPhase(cosA, 0.3) * 0.25 * occl)), lowSun * 0.6);
      vec3 S = uLightLow * direct * 0.9 + amb;
      float ext = d * sigma;
      float Ts = exp(-ext * dt);
      L += T * S * (1.0 - Ts);
      T *= Ts;
      if (T < 0.015) break;
    }
    t += dt;
  }
  // Lightning: light the cloud from inside, around a random strike point.
  if (uFlash > 0.0) {
    vec3 pc = rd * (base + thick * 0.3) / rd.z;
    float fall = exp(-dot(pc.xy - uFlashPos, pc.xy - uFlashPos) / (1800.0 * 1800.0));
    L += vec3(0.75, 0.8, 1.0) * uFlash * (0.35 + 2.5 * fall) * (1.0 - T * 0.7);
  }
  return vec4(L, T);
}

// Cheap 2D fallback for the low layer (quality: low).
vec4 flatLow(vec3 rd) {
  float base = layerBase();
  vec2 p = rd.xy * (base / rd.z);
  float cov = coverageAt(p);
  vec3 q = vec3(p + uWindLow, 0.0);
  float ev = uTime * 0.0008;
  float n = texture(uNoise, q / 3200.0 + vec3(0.0, 0.0, ev)).r * 0.7 + texture(uNoise, q / 640.0 + vec3(0.0, 0.0, ev * 3.0)).g * 0.3;
  float d = saturate(remap(n, 1.0 - cov, 1.0, 0.0, 1.0)) * cov;
  float alpha = 1.0 - exp(-d * mix(5.0, 12.0, uStorm));
  float thin = 1.0 - saturate(d * 2.5);
  float cosA = dot(rd, uLightDir);
  vec3 col = uAmbBottom * 1.2 + uAmbTop * 0.6 * (1.0 - d) + uLightLow * (0.08 + thin * hgPhase(cosA, 0.7) * 2.5);
  col *= mix(1.0, 0.45, uStorm);
  return vec4(col * alpha, 1.0 - alpha);
}

// ---------- procedural 2D noise for the sheet layers (no texture tiling) ----------
vec2 grad2(vec2 i) { float a = hash32(i).x * 6.2831853; return vec2(cos(a), sin(a)); }
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(grad2(i), f);
  float b = dot(grad2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(grad2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(grad2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4 + 0.5; // ~0..1
}
float fbm2(vec2 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * gnoise(p); n += a;
    p = r * p * 2.03 + 17.1; a *= 0.5;
  }
  return s / n;
}
// Cellular (Worley) distance to nearest jittered point: altocumulus puffs.
// Altocumulus puff field: each cell holds a rounded puff of random size (some cells empty).
// Takes the max over neighbouring puffs, so the field is continuous: no seams where cells meet.
float cellPuffs(vec2 p, float rough) {
  vec2 i = floor(p), f = fract(p);
  float v = 0.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec3 h = hash32(i + o);
      vec2 c = o + 0.1 + 0.8 * h.xy - f;
      float rad = mix(0.35, 0.75, h.z);
      float dd = length(c) / rad + (rough - 0.5) * 0.6;
      v = max(v, smoothstep(1.05, 0.15, dd) * smoothstep(0.1, 0.35, h.z));
    }
  return v;
}

// ---------- mid layer: altocumulus / altostratus at ~4.6 km ----------
// Rows of small rounded puffs ("mackerel sky") inside larger patches; becomes a continuous
// gray altostratus sheet as coverage approaches 100%.
vec4 midLayer(vec3 rd) {
  if (uCoverMid < 0.01) return vec4(0.0, 0.0, 0.0, 1.0);
  float h = 4600.0;
  vec2 p = rd.xy * (h / rd.z) + uWindMid;
  vec2 wdir = uWindDir, perp = vec2(-wdir.y, wdir.x);
  vec2 s = vec2(dot(p, wdir), dot(p, perp));
  float cov = uCoverMid;
  float patchN = fbm2(s / 9000.0 + 3.7, 4);
  float th = 0.76 - cov * 0.62;
  float patchM = smoothstep(th, th + 0.18, patchN);
  // Puffs, slightly stretched across the wind and gently warped into irregular rows.
  vec2 warp = vec2(fbm2(s / 2600.0, 3), fbm2(s / 2600.0 + 9.2, 3)) - 0.5;
  vec2 cq = (s + warp * 700.0) / vec2(230.0, 175.0);
  float rough = fbm2(s / 90.0, 3);
  // Rounded puffs with ragged edges; some cells empty so the pattern never reads as a grid.
  float puff = cellPuffs(cq, rough) * (0.45 + 0.55 * rough);
  float sheet = fbm2(s / 1400.0, 4);
  float deck = smoothstep(0.6, 1.0, cov);
  float d = patchM * mix(puff, 0.55 + 0.45 * sheet, deck);
  float alpha = (1.0 - exp(-d * mix(1.3, 5.0, deck))) * mix(0.55, 1.0, deck) * smoothstep(0.0, 0.08, cov);
  float cosA = dot(rd, uLightDir);
  // Seen from below, a puff's thick middle is shaded gray and its thin rim catches the light.
  float thick = saturate(d * 1.6);
  vec3 col = (uAmbTop * 0.75 + uAmbBottom * 0.4) * mix(1.0, 0.55, thick)
           + uLightMid * (0.04 + hgPhase(cosA, 0.65) * (0.15 + 1.1 * (1.0 - thick)) * (1.0 - deck * 0.5));
  return vec4(col * alpha, 1.0 - alpha);
}

// ---------- scud: ragged fractus fragments racing below a storm or rain base ----------
// Low (~400 m) so they cross the view quickly even in moderate wind: the strongest motion cue
// under a storm. Darker than the deck above, lit mostly from below and by lightning.
vec4 scudLayer(vec3 rd) {
  float amt = uScud;
  if (amt < 0.01) return vec4(0.0, 0.0, 0.0, 1.0);
  float h = min(420.0, layerBase() * 0.6);
  vec2 p = rd.xy * (h / rd.z) + uWindLow * 1.15;
  vec2 wdir = uWindDir, perp = vec2(-wdir.y, wdir.x);
  vec2 s = vec2(dot(p, wdir), dot(p, perp));
  float t = uTime * 0.0008;
  vec2 warp = vec2(fbm2(s / 900.0 + t * 20.0, 3), fbm2(s / 900.0 + 5.3 - t * 20.0, 3)) - 0.5;
  vec2 q = s + warp * 500.0;
  float n = fbm2(q / vec2(1300.0, 700.0), 5);
  float rag = fbm2(q / 160.0, 3);
  float th = 0.72 - amt * 0.25;
  float d = smoothstep(th, th + 0.18, n * 0.85 + rag * 0.15);
  float alpha = d * 0.9;
  // Shadowed by the deck overhead: noticeably darker than the base behind it.
  vec3 col = uAmbBottom * 0.5 + uAmbTop * 0.1 * (1.0 - d * 0.5) + vec3(0.75, 0.8, 1.0) * uFlash * 0.6;
  return vec4(col * alpha, 1.0 - alpha);
}

// ---------- high layer: cirrus at ~9 km ----------
// Fibrous ice-crystal streaks: ridged, strongly wind-stretched noise whose flow lines curve
// (domain warping), grouped into irregular patches, with denser "tufts" where fibers hook.
vec4 highLayer(vec3 rd) {
  if (uCoverHigh < 0.01) return vec4(0.0, 0.0, 0.0, 1.0);
  // Cirrus strands were drawn into uCirrus (premultiplied) by the strand pass.
  vec4 strands = texture(uCirrus, vUv);
  // Cirrostratus veil: a faint milky sheet that appears as high cover increases.
  float h = 9000.0;
  vec2 p = rd.xy * (h / rd.z) + uWindHigh;
  float cov = uCoverHigh;
  float veil = smoothstep(0.45, 1.0, cov) * (0.35 + 0.3 * fbm2(p / 12000.0, 3)) * 0.15;
  float cosA = dot(rd, uSunDir);
  vec3 vcol = uAmbTop * 1.15 + uLightHigh * (0.09 + hgPhase(cosA, 0.8) * 0.9 + hgPhase(cosA, 0.3) * 0.25);
  // Composite strands over the veil.
  vec3 col = vcol * veil * (1.0 - strands.a) + strands.rgb;
  float alpha = 1.0 - (1.0 - veil) * (1.0 - strands.a);
  return vec4(col, 1.0 - alpha);
}

vec3 acesFilm(vec3 x) {
  return saturate((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
}

void main() {
  vec3 rd = viewDir(vUv);

  // Atmosphere
  vec3 col = skyRadiance(rd) + uNightSky;
  float sunCos = dot(rd, uSunDir);
  float sunAng = acos(clamp(sunCos, -1.0, 1.0));
  col += uSunDisk * smoothstep(0.0062, 0.0042, sunAng);               // disk (slightly oversized for low res)
  col += uSunDisk * 0.0016 / (sunAng * sunAng * 40.0 + 0.015) * 0.02;  // bloom halo
  float moonAng = acos(clamp(dot(rd, uMoonDir), -1.0, 1.0));
  col += uMoonGlow * (0.02 / (moonAng * moonAng * 60.0 + 0.02));

  float transm = 1.0;

  vec4 hi = highLayer(rd);
  col = col * hi.a + hi.rgb;
  transm *= hi.a;

  vec4 mid = midLayer(rd);
  col = col * mid.a + mid.rgb;
  transm *= mid.a;

#if CLOUD_STEPS > 0
  vec4 low = uCoverLow > 0.005 ? marchLow(rd, fract(ign(gl_FragCoord.xy) + uFrame * 0.618034)) : vec4(0.0, 0.0, 0.0, 1.0);
#else
  vec4 low = uCoverLow > 0.005 ? flatLow(rd) : vec4(0.0, 0.0, 0.0, 1.0);
#endif
  col = col * low.a + low.rgb;
  transm *= low.a;

  vec4 scud = scudLayer(rd);
  col = col * scud.a + scud.rgb;
  transm *= scud.a;

  // Storms read cooler and darker: slate blue-gray rather than brown.
  float lumS = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lumS * 0.86, lumS * 0.95, lumS * 1.12) * 0.8, uStorm * 0.75);

  // Haze / fog and rain veil.
  float fog = saturate(uHaze * 0.7 + uRain * 0.15);
  col = mix(col, uFogColor, fog);
  transm *= 1.0 - fog;

  // Gentle saturation lift (single scattering + tonemapping both wash colors out a little).
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(vec3(0.0), mix(vec3(lum), col, 1.18));
  col = acesFilm(col);
  col = pow(col, vec3(1.0 / 2.2));
  // Temporal accumulation: each frame uses a different ray offset; blending frames removes
  // raymarch noise. Clouds move slowly, so the history barely smears.
  vec4 prev = texture(uPrev, vUv);
  outColor = mix(vec4(col, transm), prev, uHistory);
}
