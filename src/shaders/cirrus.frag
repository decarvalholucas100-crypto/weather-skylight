in float vAcross;
in float vAlong;
in float vAlpha;
in vec3 vDir;
in float vSeed;
out vec4 outColor;

uniform vec3 uSunDir;
uniform vec3 uAmbTop;
uniform vec3 uLightHigh;

void main() {
  // Soft across-profile with a few internal fibrils, so overlapping strands read as hair.
  float x = vAcross;
  float profile = exp(-x * x * 3.2);
  float fibril = 0.85 + 0.15 * sin(x * 7.0 + vSeed * 50.0 + vAlong * 4.0);
  float a = clamp(vAlpha * profile * fibril, 0.0, 1.0) * 0.11;
  float c = dot(normalize(vDir), uSunDir);
  // Ice crystals: strong forward scattering, so cirrus near the sun glows.
  float g1 = 0.8, g2 = 0.3;
  float ph = (1.0 - g1 * g1) / (12.566 * pow(1.0 + g1 * g1 - 2.0 * g1 * c, 1.5)) * 0.9
           + (1.0 - g2 * g2) / (12.566 * pow(1.0 + g2 * g2 - 2.0 * g2 * c, 1.5)) * 0.25;
  vec3 col = uAmbTop * 1.15 + uLightHigh * (0.09 + ph);
  outColor = vec4(col * a, a); // premultiplied
}
