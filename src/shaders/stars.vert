#version 300 es
// Stars as point sprites, positioned from real RA/Dec and rotated with sidereal time.
precision highp float;
layout(location = 0) in vec3 aEq;     // unit vector in equatorial coordinates
layout(location = 1) in vec2 aMagCol; // visual magnitude, B-V color index

uniform mat3 uWorldToEq;
uniform mat3 uCamRot;
uniform vec2 uTanHalf;
uniform float uLimitMag;
uniform float uPxScale;  // point size scale (resolution dependent)
uniform float uTime;
uniform int uPlanetStart;  // vertices from here on are planets: steady light, no twinkle

out vec3 vColor;
out float vBright;

vec3 bvToRgb(float bv) {
  // Approximate blackbody tint by B-V index: blue-white to orange.
  float t = clamp((bv + 0.3) / 2.2, 0.0, 1.0);
  return mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.72, 0.45), t) * mix(1.0, 0.95, t);
}

void main() {
  vec3 world = transpose(uWorldToEq) * aEq;      // equatorial -> ENU
  vec3 local = transpose(uCamRot) * world;       // ENU -> camera
  float mag = aMagCol.x;
  float vis = clamp((uLimitMag - mag) / 1.2, 0.0, 1.0);
  if (local.z <= 0.05 || vis <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vBright = 0.0;
    vColor = vec3(0.0);
    return;
  }
  vec2 s = vec2(-local.x, local.y) / local.z / uTanHalf;
  gl_Position = vec4(s, 0.0, 1.0);
  // Brightness from magnitude (each magnitude is 2.512x), with gentle scintillation.
  float flux = pow(2.512, -mag + 1.0);
  float tw = gl_VertexID >= uPlanetStart ? 1.0 : 1.0 + 0.18 * sin(uTime * (7.0 + fract(aEq.x * 911.0) * 9.0) + aEq.y * 400.0);
  // Perceptual compression: faint stars stay visible next to bright ones, as to the dark-adapted eye.
  vBright = min(4.0, pow(flux, 0.6) * 1.8 + 0.18) * vis * tw;
  gl_PointSize = uPxScale * (5.0 + 5.0 * clamp(1.6 - mag * 0.55, 0.0, 2.4));
  vColor = bvToRgb(aMagCol.y);
}
