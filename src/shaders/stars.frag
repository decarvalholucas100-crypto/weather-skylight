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
  float core = exp(-r * r * 9.0) + 0.15 * exp(-r * r * 2.5);
  // Clouds and haze hide stars: the sky pass stored its transmittance in alpha.
  float transm = texture(uSky, gl_FragCoord.xy / uResolution).a;
  float a = core * vBright * uStarVis * transm;
  outColor = vec4(vColor * a * uBrightness, 1.0);
}
