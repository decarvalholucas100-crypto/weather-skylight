// Physically based sky radiance (single scattering: Rayleigh + Mie + ozone absorption) over the
// upper hemisphere, stored in a small lookup texture. Spherical Earth, so twilight and the
// Earth's shadow come out naturally. Constants follow Bruneton & Neyret 2008 / Hillaire 2020.
in vec2 vUv;
out vec4 outColor;

uniform vec3 uSunDir;
uniform float uMieScale;
uniform float uExposure;

const float Re = 6360e3;
const float Ra = 6420e3;
const vec3 betaR = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float betaM = 3.996e-6;
const float betaMext = 4.44e-6;
const vec3 betaO = vec3(0.65e-6, 1.881e-6, 0.085e-6);
const float Hr = 8000.0;
const float Hm = 1200.0;
const float SUN_I = 20.0;

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(-1.0);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

vec3 densities(float h) {
  return vec3(exp(-h / Hr), exp(-h / Hm), max(0.0, 1.0 - abs(h - 25000.0) / 15000.0));
}

vec3 extinction(vec3 od) {
  return exp(-(betaR * od.x + betaMext * uMieScale * od.y + betaO * od.z));
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float theta = min(r, 1.0) * (PI * 0.5);
  vec2 hd = r > 1e-5 ? p / r : vec2(0.0, 1.0);
  vec3 rd = vec3(hd * sin(theta), cos(theta));
  rd.z = max(rd.z, 0.002);
  rd = normalize(rd);

  vec3 ro = vec3(0.0, 0.0, Re + 20.0);
  float tMax = raySphere(ro, rd, Ra).y;
  float dt = tMax / float(SKY_SAMPLES);

  float mu = dot(rd, uSunDir);
  float pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = 0.76;
  float pM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));

  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  vec3 odView = vec3(0.0);
  for (int i = 0; i < SKY_SAMPLES; i++) {
    float t = (float(i) + 0.5) * dt;
    vec3 pos = ro + rd * t;
    float h = length(pos) - Re;
    vec3 dens = densities(h) * dt;
    odView += dens;

    // Light path to the sun; zero if the planet is in the way (Earth's shadow).
    vec2 g0 = raySphere(pos, uSunDir, Re);
    if (g0.x > 0.0) continue;
    float tl = raySphere(pos, uSunDir, Ra).y;
    float dl = tl / 6.0;
    vec3 odLight = vec3(0.0);
    for (int j = 0; j < 6; j++) {
      vec3 lp = pos + uSunDir * ((float(j) + 0.5) * dl);
      odLight += densities(length(lp) - Re) * dl;
    }
    vec3 att = extinction(odView + odLight);
    sumR += att * dens.x;
    sumM += att * dens.y;
  }
  vec3 L = SUN_I * (sumR * betaR * pR + sumM * betaM * uMieScale * pM);
  // Cheap multiple-scattering lift (isotropic share of in-scatter) so twilight isn't too saturated.
  L += SUN_I * 0.06 * (sumR * betaR + sumM * betaM * uMieScale) / (4.0 * PI);
  // Twilight grade: the deep blue of the blue hour comes largely from multiple scattering and
  // ozone, which single scattering underestimates. Nudge toward blue as the sun sets.
  float tw = smoothstep(0.2, -0.1, uSunDir.z);
  L *= mix(vec3(1.0), vec3(0.42, 0.72, 1.3), tw);
  outColor = vec4(encodeHdr(L * uExposure), 1.0);
}
