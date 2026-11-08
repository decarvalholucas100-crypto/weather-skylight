// WebGL2 renderer. Four passes per frame:
//  1. sky LUT    (128x128)      physically based sky color over the hemisphere
//  2. sky        (reduced res)  atmosphere + sun + clouds, tonemapped; alpha = cloud transmittance
//  3. composite  (full res)     upscale, moon, rain on glass, brightness, dither
//  4. stars      (full res)     real bright stars as point sprites, hidden by clouds
import { config, type QualityPreset } from '../config';
import type { Vec3 } from '../astro';
import { generateCloudNoise } from './noise';
import { buildStarBuffer } from '../stars';
import common from '../shaders/common.glsl?raw';
import fullscreenVert from '../shaders/fullscreen.vert?raw';
import skyLutFrag from '../shaders/skylut.frag?raw';
import skyFrag from '../shaders/sky.frag?raw';
import compositeFrag from '../shaders/composite.frag?raw';
import starsVert from '../shaders/stars.vert?raw';
import starsFrag from '../shaders/stars.frag?raw';

export interface FrameUniforms {
  sunDir: Vec3;
  moonDir: Vec3;
  lightDir: Vec3;
  lightLow: Vec3;
  lightMid: Vec3;
  lightHigh: Vec3;
  ambTop: Vec3;
  ambBottom: Vec3;
  sunDisk: Vec3;
  nightSky: Vec3;
  moonGlow: Vec3;
  moonColor: Vec3;
  fogColor: Vec3;
  glassTint: Vec3;
  exposure: number;
  mieScale: number;
  coverLow: number;
  coverMid: number;
  coverHigh: number;
  storm: number;
  rain: number;
  wet: number;
  haze: number;
  cloudTime: number;
  realTime: number;
  windLow: [number, number];
  windMid: [number, number];
  windHigh: [number, number];
  windDir: [number, number];
  flash: number;
  flashPos: [number, number];
  brightness: number;
  worldToEq: Float32Array;
  starLimitMag: number;
  starVis: number;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    console.error(log, '\n', numbered);
    throw new Error('Shader compile failed: ' + log);
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): { prog: WebGLProgram; u: Uniforms } {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link failed: ' + gl.getProgramInfoLog(p));
  const u: Uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i)!;
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { prog: p, u };
}

function frag(defines: Record<string, number>, body: string): string {
  const defs = Object.entries(defines).map(([k, v]) => `#define ${k} ${v}`).join('\n');
  return `#version 300 es\n${defs}\n${common}\n${body}`;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private quality: QualityPreset;
  private lut!: { prog: WebGLProgram; u: Uniforms };
  private sky!: { prog: WebGLProgram; u: Uniforms };
  private comp!: { prog: WebGLProgram; u: Uniforms };
  private stars!: { prog: WebGLProgram; u: Uniforms };
  private vao!: WebGLVertexArrayObject;
  private starVao!: WebGLVertexArrayObject;
  private starCount = 0;
  private noiseTex!: WebGLTexture;
  private lutTex!: WebGLTexture;
  private lutFbo!: WebGLFramebuffer;
  private skyTexs: WebGLTexture[] = [];
  private skyFbos: WebGLFramebuffer[] = [];
  private ping = 0;
  private frameNo = 0;
  private historyValid = false;
  /** Temporal blend weight; lowered when time is sped up to avoid smearing. */
  history = 0.8;
  private skyW = 0;
  private skyH = 0;
  private readonly lutSize = 128;
  outW = 0;
  outH = 0;
  private tanHalf: [number, number] = [1, 1];
  private camRot = new Float32Array(9);

  constructor(canvas: HTMLCanvasElement, quality: QualityPreset) {
    this.canvas = canvas;
    this.quality = quality;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this.init();
  }

  private init(): void {
    const gl = this.gl;
    this.vao = gl.createVertexArray()!;
    this.buildPrograms();

    // Cloud noise volume
    const N = 64;
    const t0 = performance.now();
    const data = generateCloudNoise(N);
    console.info(`cloud noise generated in ${(performance.now() - t0).toFixed(0)} ms`);
    this.noiseTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, this.noiseTex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, N, N, N, 0, gl.RGBA, gl.FLOAT, data);
    // No mipmaps: generating them needs a renderable float format, which the Pi may lack.
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT);

    // Sky LUT target
    this.lutTex = this.makeTarget(this.lutSize, this.lutSize, false);
    this.lutFbo = this.makeFbo(this.lutTex);

    // Stars
    const { data: starData, count } = buildStarBuffer();
    this.starCount = count;
    this.starVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.starVao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, starData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
  }

  private buildPrograms(): void {
    const gl = this.gl;
    const q = this.quality;
    this.lut = program(gl, fullscreenVert, frag({ SKY_SAMPLES: q.skySamples }, skyLutFrag));
    this.sky = program(gl, fullscreenVert, frag({ CLOUD_STEPS: q.cloudSteps, LIGHT_STEPS: Math.max(1, q.lightSteps) }, skyFrag));
    this.comp = program(gl, fullscreenVert, frag({}, compositeFrag));
    this.stars = program(gl, starsVert, frag({}, starsFrag));
  }

  setQuality(q: QualityPreset): void {
    this.quality = q;
    this.buildPrograms();
    this.resize(true);
  }

  private makeTarget(w: number, h: number, mips: boolean): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
  }

  private makeFbo(tex: WebGLTexture): WebGLFramebuffer {
    const gl = this.gl;
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
  }

  /** Sizes the canvas and internal targets. Call on window resize. */
  resize(force = false): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = window.innerWidth, cssH = window.innerHeight;
    let w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    const maxW = this.quality.outputMaxWidth;
    if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW; }
    if (!force && w === this.outW && h === this.outH) return;
    this.outW = w; this.outH = h;
    this.canvas.width = w; this.canvas.height = h;

    let sw = Math.max(64, Math.round(w * this.quality.renderScale));
    let sh = Math.max(36, Math.round(h * this.quality.renderScale));
    if (sw > this.quality.maxInternalWidth) { sh = Math.round((sh * this.quality.maxInternalWidth) / sw); sw = this.quality.maxInternalWidth; }
    this.skyW = sw; this.skyH = sh;
    const gl = this.gl;
    this.skyTexs.forEach((t) => gl.deleteTexture(t));
    this.skyFbos.forEach((f) => gl.deleteFramebuffer(f));
    this.skyTexs = [this.makeTarget(sw, sh, true), this.makeTarget(sw, sh, true)];
    this.skyFbos = this.skyTexs.map((t) => this.makeFbo(t));
    this.historyValid = false;

    // Camera: diagonal FOV split into horizontal/vertical tangents.
    const a = w / h;
    const tD = Math.tan(((config.fovDeg / 2) * Math.PI) / 180);
    this.tanHalf = [(tD * a) / Math.hypot(a, 1), tD / Math.hypot(a, 1)];
    // Rotate about the vertical so the top of the screen faces config.headingDeg.
    const th = (-config.headingDeg * Math.PI) / 180;
    const c = Math.cos(th), s = Math.sin(th);
    this.camRot.set([c, s, 0, -s, c, 0, 0, 0, 1]);
  }

  get internalSize(): [number, number] {
    return [this.skyW, this.skyH];
  }

  private setCamera(u: Uniforms): void {
    const gl = this.gl;
    gl.uniform2f(u.uTanHalf, this.tanHalf[0], this.tanHalf[1]);
    gl.uniformMatrix3fv(u.uCamRot, false, this.camRot);
  }

  render(f: FrameUniforms): void {
    const gl = this.gl;
    this.resize();
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    // 1. Sky LUT
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lutFbo);
    gl.viewport(0, 0, this.lutSize, this.lutSize);
    gl.useProgram(this.lut.prog);
    let u = this.lut.u;
    gl.uniform3fv(u.uSunDir, f.sunDir);
    gl.uniform1f(u.uMieScale, f.mieScale);
    gl.uniform1f(u.uExposure, f.exposure);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. Sky + clouds at internal resolution
    const cur = this.ping, prev = 1 - this.ping;
    this.ping = prev;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.skyFbos[cur]);
    gl.viewport(0, 0, this.skyW, this.skyH);
    gl.useProgram(this.sky.prog);
    u = this.sky.u;
    this.setCamera(u);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.uniform1i(u.uSkyLut, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.noiseTex);
    gl.uniform1i(u.uNoise, 1);
    const v3: [string, Vec3][] = [
      ['uSunDir', f.sunDir], ['uLightDir', f.lightDir], ['uLightLow', f.lightLow], ['uLightMid', f.lightMid],
      ['uLightHigh', f.lightHigh], ['uAmbTop', f.ambTop], ['uAmbBottom', f.ambBottom], ['uSunDisk', f.sunDisk],
      ['uNightSky', f.nightSky], ['uMoonDir', f.moonDir], ['uMoonGlow', f.moonGlow], ['uFogColor', f.fogColor],
    ];
    for (const [k, v] of v3) gl.uniform3fv(u[k], v);
    gl.uniform1f(u.uCoverLow, f.coverLow);
    gl.uniform1f(u.uCoverMid, f.coverMid);
    gl.uniform1f(u.uCoverHigh, f.coverHigh);
    gl.uniform1f(u.uStorm, f.storm);
    gl.uniform1f(u.uRain, f.rain);
    gl.uniform1f(u.uHaze, f.haze);
    gl.uniform1f(u.uTime, f.cloudTime);
    gl.uniform2fv(u.uWindLow, f.windLow);
    gl.uniform2fv(u.uWindMid, f.windMid);
    gl.uniform2fv(u.uWindHigh, f.windHigh);
    gl.uniform2fv(u.uWindDir, f.windDir);
    gl.uniform1f(u.uFlash, f.flash);
    gl.uniform2fv(u.uFlashPos, f.flashPos);
    gl.uniform2f(u.uResolution, this.skyW, this.skyH);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.skyTexs[prev]);
    gl.uniform1i(u.uPrev, 2);
    gl.uniform1f(u.uHistory, this.historyValid ? this.history : 0);
    gl.uniform1f(u.uFrame, this.frameNo++ % 64);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.historyValid = true;
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.skyTexs[cur]);
    gl.generateMipmap(gl.TEXTURE_2D);

    // 3. Composite to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.outW, this.outH);
    gl.useProgram(this.comp.prog);
    u = this.comp.u;
    this.setCamera(u);
    gl.uniform1i(u.uSky, 0);
    gl.uniform2f(u.uResolution, this.outW, this.outH);
    gl.uniform1f(u.uTime, f.realTime);
    gl.uniform1f(u.uRain, f.rain);
    gl.uniform1f(u.uWet, f.wet);
    gl.uniform1f(u.uBrightness, f.brightness);
    gl.uniform1f(u.uVignette, config.vignette);
    gl.uniform3fv(u.uMoonDir, f.moonDir);
    gl.uniform3fv(u.uSunDir, f.sunDir);
    gl.uniform3fv(u.uMoonColor, f.moonColor);
    gl.uniform1f(u.uMoonRadius, 0.00452 * config.moonScale);
    gl.uniform3fv(u.uGlassTint, f.glassTint);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 4. Stars, additive
    if (f.starVis > 0.001) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.stars.prog);
      u = this.stars.u;
      this.setCamera(u);
      gl.uniformMatrix3fv(u.uWorldToEq, false, f.worldToEq);
      gl.uniform1f(u.uLimitMag, f.starLimitMag);
      gl.uniform1f(u.uPxScale, Math.max(1, this.outH / 1080) * 1.0);
      gl.uniform1f(u.uTime, f.realTime);
      gl.uniform1i(u.uSky, 0);
      gl.uniform2f(u.uResolution, this.outW, this.outH);
      gl.uniform1f(u.uStarVis, f.starVis);
      gl.uniform1f(u.uBrightness, f.brightness);
      gl.bindVertexArray(this.starVao);
      gl.drawArrays(gl.POINTS, 0, this.starCount);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }
}
