// WebGL2 renderer. Four passes per frame:
//  1. sky LUT    (128x128)      physically based sky color over the hemisphere
//  2. sky        (reduced res)  atmosphere + sun + clouds, tonemapped; alpha = cloud transmittance
//  3. composite  (full res)     upscale, moon, rain on glass, brightness, dither
//  4. stars      (full res)     real bright stars as point sprites, hidden by clouds
import { config, type QualityPreset } from '../config';
import type { Vec3 } from '../astro';
import { generateCloudNoise } from './noise';
import { buildStarBuffer } from '../stars';
import { PLANET_COUNT } from '../planets';
import common from '../shaders/common.glsl?raw';
import fullscreenVert from '../shaders/fullscreen.vert?raw';
import skyLutFrag from '../shaders/skylut.frag?raw';
import skyFrag from '../shaders/sky.frag?raw';
import compositeFrag from '../shaders/composite.frag?raw';
import starsVert from '../shaders/stars.vert?raw';
import starsFrag from '../shaders/stars.frag?raw';
import cirrusVert from '../shaders/cirrus.vert?raw';
import cirrusFrag from '../shaders/cirrus.frag?raw';

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
  moonGlowAmt: number;
  fogColor: Vec3;
  glassTint: Vec3;
  exposure: number;
  mieScale: number;
  coverLow: number;
  lowBase: number;
  convective: number;
  towers: number;
  underDeck: number;
  scud: number;
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
  milkyWay: number;
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
  private cirrus!: { prog: WebGLProgram; u: Uniforms };
  private cirrusTex: WebGLTexture | null = null;
  private cirrusFbo: WebGLFramebuffer | null = null;
  private emptyVao!: WebGLVertexArrayObject;
  private vao!: WebGLVertexArrayObject;
  private starVao!: WebGLVertexArrayObject;
  private starCount = 0;
  private starBuf!: WebGLBuffer;
  private planetOffset = 0;
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
  private prevWind: [number, number] | null = null;
  private skyW = 0;
  private skyH = 0;
  private readonly lutSize = 128;
  /** Dynamic resolution factor (0.55..1) applied on top of the preset's render scale. */
  private dynScale = 1;
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
    this.emptyVao = gl.createVertexArray()!;
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
    this.upgradeNoise();

    // Sky LUT target
    this.lutTex = this.makeTarget(this.lutSize, this.lutSize, false);
    this.lutFbo = this.makeFbo(this.lutTex);

    // Stars
    const { data: starData, count } = buildStarBuffer();
    // Planets ride at the end of the star buffer and are updated as they move.
    this.starCount = count + PLANET_COUNT;
    this.planetOffset = count * 20;
    const all = new Float32Array((count + PLANET_COUNT) * 5);
    all.set(starData);
    this.starVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.starVao);
    const buf = gl.createBuffer()!;
    this.starBuf = buf;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, all, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
  }

  /** Swap in a higher-resolution noise volume, generated in a worker (same pattern, finer detail). */
  private upgradeNoise(): void {
    const N = this.quality.noiseSize;
    if (N <= 64 || typeof Worker === 'undefined') return;
    try {
      const worker = new Worker(new URL('./noiseWorker.ts', import.meta.url), { type: 'module' });
      const t0 = performance.now();
      worker.onmessage = (e: MessageEvent<Float32Array>) => {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_3D, this.noiseTex);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, N, N, N, 0, gl.RGBA, gl.FLOAT, e.data);
        gl.bindTexture(gl.TEXTURE_3D, null);
        console.info(`cloud noise ${N}^3 ready in ${(performance.now() - t0).toFixed(0)} ms`);
        worker.terminate();
      };
      worker.onerror = () => worker.terminate();
      worker.postMessage(N);
    } catch {
      /* stay on the 64^3 volume */
    }
  }

  private buildPrograms(): void {
    const gl = this.gl;
    const q = this.quality;
    this.lut = program(gl, fullscreenVert, frag({ SKY_SAMPLES: q.skySamples }, skyLutFrag));
    this.sky = program(gl, fullscreenVert, frag({ CLOUD_STEPS: q.cloudSteps, LIGHT_STEPS: Math.max(1, q.lightSteps) }, skyFrag));
    this.comp = program(gl, fullscreenVert, frag({}, compositeFrag));
    this.stars = program(gl, starsVert, frag({}, starsFrag));
    this.cirrus = program(gl, cirrusVert, frag({}, cirrusFrag));
  }

  /** Adjust dynamic resolution; only rebuilds targets when the change is meaningful. */
  setDynamicScale(k: number): void {
    const v = Math.min(1, Math.max(0.55, k));
    if (Math.abs(v - this.dynScale) < 0.04) return;
    this.dynScale = v;
    this.resize(true);
  }

  get dynamicScale(): number {
    return this.dynScale;
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

    const scale = this.quality.renderScale * this.dynScale;
    let sw = Math.max(64, Math.round(w * scale));
    let sh = Math.max(36, Math.round(h * scale));
    if (sw > this.quality.maxInternalWidth) { sh = Math.round((sh * this.quality.maxInternalWidth) / sw); sw = this.quality.maxInternalWidth; }
    this.skyW = sw; this.skyH = sh;
    const gl = this.gl;
    this.skyTexs.forEach((t) => gl.deleteTexture(t));
    this.skyFbos.forEach((f) => gl.deleteFramebuffer(f));
    this.skyTexs = [this.makeTarget(sw, sh, true), this.makeTarget(sw, sh, true)];
    this.skyFbos = this.skyTexs.map((t) => this.makeFbo(t));
    if (this.cirrusTex) gl.deleteTexture(this.cirrusTex);
    if (this.cirrusFbo) gl.deleteFramebuffer(this.cirrusFbo);
    this.cirrusTex = this.makeTarget(sw, sh, false);
    this.cirrusFbo = this.makeFbo(this.cirrusTex);
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

  /** Update planet positions: rows of [eqX, eqY, eqZ, mag, bv]. */
  setPlanets(rows: number[]): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, this.planetOffset, new Float32Array(rows));
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
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

    // 1b. Cirrus strands into their own target (premultiplied alpha, additive "over").
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cirrusFbo);
    gl.viewport(0, 0, this.skyW, this.skyH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (f.coverHigh > 0.01) {
      gl.useProgram(this.cirrus.prog);
      const cu = this.cirrus.u;
      this.setCamera(cu);
      gl.uniform2fv(cu.uWindHigh, f.windHigh);
      gl.uniform2fv(cu.uWindDir, f.windDir);
      gl.uniform1f(cu.uCover, f.coverHigh);
      gl.uniform1f(cu.uTime, f.cloudTime);
      gl.uniform2f(cu.uPixel, 2 / this.skyW, 2 / this.skyH);
      const segs = 24;
      gl.uniform1i(cu.uSegments, segs);
      gl.uniform3fv(cu.uSunDir, f.sunDir);
      gl.uniform3fv(cu.uAmbTop, f.ambTop);
      gl.uniform3fv(cu.uLightHigh, f.lightHigh);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (segs + 1) * 2, this.quality.cirrusStrands);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this.vao);
    }

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
    gl.uniform1f(u.uLowBase, f.lowBase);
    gl.uniform1f(u.uConvective, f.convective);
    gl.uniform1f(u.uTowers, f.towers);
    gl.uniform1f(u.uUnderDeck, f.underDeck);
    gl.uniform1f(u.uScud, f.scud);
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
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.cirrusTex);
    gl.uniform1i(u.uCirrus, 3);
    // Motion compensation: clouds drifted since last frame, so fetch history from where each
    // feature used to be. Uses the low layer's height (the fastest-moving, most visible layer).
    let shiftX = 0, shiftY = 0, histOk = this.historyValid;
    if (this.prevWind) {
      const dx = f.windLow[0] - this.prevWind[0], dy = f.windLow[1] - this.prevWind[1];
      if (Math.hypot(dx, dy) > 1500) histOk = false; // wrap-around jump
      else {
        const c = this.camRot[0], s = this.camRot[1];
        const lx = c * -dx + s * -dy, ly = -s * -dx + c * -dy; // feature motion, camera frame
        const h = f.lowBase + 400;
        shiftX = (-lx / h / this.tanHalf[0]) * 0.5;
        shiftY = (ly / h / this.tanHalf[1]) * 0.5;
      }
    }
    this.prevWind = [f.windLow[0], f.windLow[1]];
    gl.uniform2f(u.uHistShift, shiftX, shiftY);
    gl.uniform1f(u.uHistory, histOk ? this.history : 0);
    // Halton(2,3) sub-pixel jitter sequence (8 frames) for temporal anti-aliasing.
    const fi = (this.frameNo % 8) + 1;
    const halton = (i: number, b: number) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
    gl.uniform2f(u.uJitter, halton(fi, 2) - 0.5, halton(fi, 3) - 0.5);
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
    gl.uniform1f(u.uPixelAngle, (2 * this.tanHalf[1]) / this.outH);
    gl.uniform1f(u.uMoonGlowAmt, f.moonGlowAmt);
    gl.uniform3fv(u.uGlassTint, f.glassTint);
    gl.uniformMatrix3fv(u.uWorldToEq, false, f.worldToEq);
    gl.uniform1f(u.uMilkyWay, f.milkyWay);
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
      gl.uniform1i(u.uPlanetStart, this.planetOffset / 20);
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
