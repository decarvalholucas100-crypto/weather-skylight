in vec3 vColor;
in float vBright;
out vec4 outColor;
uniform sampler2D uSky;
uniform vec2 uResolution;
uniform float uStarVis;    // fades with twilight, moonlight, haze
uniform float uBrightness;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  // Sharp seeing-disk core plus a faint glow (as the eye/lens spreads bright points).
  float core = exp(-r * r * 22.0) + 0.22 * exp(-r * r * 5.0) + 0.06 * exp(-r * r * 1.2);
  core *= smoothstep(1.0, 0.85, r);
  // Clouds and haze hide stars: the sky pass stored its transmittance in alpha.
  float transm = texture(uSky, gl_FragCoord.xy / uResolution).a;
  float a = core * vBright * uStarVis * transm;
  outColor = vec4(vColor * a * uBrightness, 1.0);
}
