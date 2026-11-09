#!/usr/bin/env node
// Visual capture harness. Renders every scenario in tools/scenarios.json at fixed viewports,
// saves full-resolution PNGs and frame timings, and builds reference | before | after
// composites. Deterministic: the app is loaded with freeze=1, notaa=1 and a fixed seed, so the
// same scenario produces the same pixels on the same machine.
//
//   node tools/capture.mjs                      capture all scenarios -> captures/<run>/
//   node tools/capture.mjs --baseline           also copy this run to captures/baseline/
//   node tools/capture.mjs --only golden-hour   one scenario (comma-separated for several)
//   node tools/capture.mjs --viewports 1080p    subset of viewports
//   node tools/capture.mjs --url https://weather-skylight.vercel.app   capture a deployment
//   node tools/capture.mjs --software           headless + SwiftShader (no GPU; slow, CI/cloud)
//   node tools/capture.mjs --frames 120         frames to render before each shot (TAA convergence)
//   node tools/capture.mjs --notaa              disable temporal AA (raw single frame; noisy)
//   node tools/capture.mjs --quality medium     force a quality preset (default: the app's, High)
//   node tools/capture.mjs --compare            composites only, from the latest run vs baseline
//
// Default is headed Chromium on the real GPU (accurate frame times). Composites are written to
// captures/<run>/composites/<scenario>_<viewport>.png: reference photo | baseline | this run.
// Frame times come from the app's own FPS counter (debug overlay) and are tagged with the
// render mode, since software rendering is 10-100x slower than any real GPU.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const log = (...m) => process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${m.join(' ')}\n`);
const root = resolve(here, '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };

const cfg = JSON.parse(readFileSync(join(here, 'scenarios.json'), 'utf8'));
const only = opt('only', '') ? opt('only', '').split(',') : Object.keys(cfg.scenarios);
const viewportNames = opt('viewports', '') ? opt('viewports', '').split(',') : Object.keys(cfg.viewports);
const software = flag('software');
const settleMs = Number(opt('settle', software ? 1200000 : 20000)); // max wait for convergence
const settleFrames = Number(opt('frames', software ? 40 : 120)); // frames to render before the shot
const quality = opt('quality', ''); // force a quality preset (high|medium|low), e.g. for smoke tests
const capturesDir = join(root, 'captures');
const refDir = join(root, 'reference');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const runDir = flag('compare') ? latestRun() : join(capturesDir, stamp);
mkdirSync(join(runDir, 'composites'), { recursive: true });

function latestRun() {
  const runs = readdirSync(capturesDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'baseline').map((d) => d.name).sort();
  if (!runs.length) throw new Error('no runs in captures/');
  return join(capturesDir, runs[runs.length - 1]);
}

async function startDevServer() {
  log('starting dev server');
  // Own process group so the whole npx -> vite tree can be killed at the end (otherwise the
  // orphaned server keeps this script alive after it has finished).
  const proc = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('vite did not start')), 60000);
    proc.stdout.on('data', (d) => { if (String(d).includes('5199')) { clearTimeout(t); res(); } });
    proc.stderr.on('data', (d) => process.stderr.write(d));
  });
  return proc;
}

function scenarioUrl(base, name, sc) {
  const p = new URLSearchParams();
  const loc = cfg.location;
  // Time frozen, fixed seed. TAA stays on: its jitter sequence is deterministic and with nothing
  // moving it converges to the same stable image given the same number of frames (see --notaa).
  p.set('freeze', '1'); p.set('seed', '7');
  if (flag('notaa')) p.set('notaa', '1'); p.set('snap', '1'); p.set('geo', '0');
  p.set('lat', String(loc.lat)); p.set('lon', String(loc.lon)); p.set('tz', loc.tz);
  p.set('date', sc.date || loc.date);
  if (quality) p.set('q', quality);
  for (const [k, v] of Object.entries(sc)) {
    if (k.startsWith('_') || k === 'reference' || k === 'date') continue;
    p.set(k, String(v));
  }
  return `${base}/?${p.toString()}`;
}

async function capture() {
  const base = opt('url', '');
  const server = base ? null : await startDevServer();
  const url = base || 'http://localhost:5199';
  const launchArgs = software
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  const browser = await chromium.launch({ headless: software, args: launchArgs });
  const timings = { renderMode: software ? 'software (SwiftShader, not representative)' : 'gpu', url, settleMs, scenarios: {} };
  // Mock the weather feeds so captures never depend on today's weather.
  const mockWeather = { current: { cloud_cover: 40, cloud_cover_low: 30, cloud_cover_mid: 10, cloud_cover_high: 20, precipitation: 0, weather_code: 2, wind_speed_10m: 4, wind_direction_10m: 270, visibility: 24000, cape: 300, lifted_index: 1, temperature_2m: 22 } };
  try {
    for (const name of only) {
      const sc = cfg.scenarios[name];
      if (!sc) { console.warn(`unknown scenario ${name}`); continue; }
      timings.scenarios[name] = {};
      for (const vpName of viewportNames) {
        const vp = cfg.viewports[vpName];
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, timezoneId: cfg.location.tz });
        await ctx.addInitScript(() => localStorage.clear());
        const page = await ctx.newPage();
        page.on('pageerror', (e) => console.error(`[${name}] page error:`, e.message));
        await page.route('**/api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(mockWeather) }));
        await page.route('**/api/metar**', (r) => r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"mocked"}' }));
        const t0 = Date.now();
        log(`goto ${name} ${vpName}`);
        await page.goto(scenarioUrl(url, name, sc) + '&debug=1', { timeout: 180000, waitUntil: 'load' });
        // Wait for the renderer to produce settleFrames frames (TAA converged), bounded by settleMs.
        await page.waitForFunction((n) => window.skylight?.ready && (window.skylight?.frames ?? 0) >= n, settleFrames, { timeout: settleMs, polling: 250 }).catch(() => log('settle timeout; capturing anyway'));
        const overlay = await page.locator('.sk-overlay').innerText().catch(() => '');
        const fps = Number((overlay.match(/fps\s+([\d.]+)/) || [])[1]) || 0;
        const dyn = Number((overlay.match(/dyn (\d+)%/) || [])[1]) || 0;
        await page.evaluate(() => { const o = document.querySelector('.sk-overlay'); if (o) o.style.display = 'none'; });
        await page.waitForTimeout(300);
        // Stop the render loop so the screenshot isn't starved (the last frame stays on screen).
        await page.evaluate(() => window.skylight?.pause());
        await page.waitForTimeout(300);
        const file = join(runDir, `${name}_${vpName}.png`);
        // The app renders one frame and returns the canvas as PNG: the output buffer's native size
        // (the quality preset caps it, e.g. 2560 wide on High, so a 4K viewport yields 2560x1440).
        log('capture');
        const dataUrl = await page.evaluate(() => window.skylight.capture());
        writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
        log('capture done');
        if (vp.upscale) await sharp(file).resize(vp.width * vp.upscale, vp.height * vp.upscale, { kernel: 'nearest' }).toFile(file.replace('.png', `_x${vp.upscale}.png`));
        timings.scenarios[name][vpName] = { fps, frameMs: fps ? Math.round(1000 / fps * 10) / 10 : null, dynamicResolutionPct: dyn, wallSec: Math.round((Date.now() - t0) / 100) / 10 };
        console.log(`${name.padEnd(20)} ${vpName.padEnd(6)} ${fps ? fps.toFixed(1) + ' fps' : 'n/a'}  dyn ${dyn}%`);
        await ctx.close();
        log('context closed');
      }
    }
  } finally {
    log('closing browser');
    await browser.close();
    log('browser closed');
    if (server) { try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); } }
  }
  writeFileSync(join(runDir, 'timings.json'), JSON.stringify(timings, null, 2));
  if (flag('baseline')) {
    const b = join(capturesDir, 'baseline');
    mkdirSync(b, { recursive: true });
    cpSync(runDir, b, { recursive: true });
    console.log('baseline updated');
  }
}

async function label(width, text) {
  const svg = `<svg width="${width}" height="36"><rect width="100%" height="100%" fill="#111"/><text x="12" y="24" font-family="sans-serif" font-size="18" fill="#eee">${text}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function panel(file, w, h, title) {
  const body = file && existsSync(file)
    ? await sharp(file).resize(w, h, { fit: 'cover' }).png().toBuffer()
    : await sharp({ create: { width: w, height: h, channels: 3, background: '#333' } }).png().toBuffer();
  return sharp({ create: { width: w, height: h + 36, channels: 3, background: '#111' } })
    .composite([{ input: await label(w, title), top: 0, left: 0 }, { input: body, top: 36, left: 0 }]).png().toBuffer();
}

// Pixel difference vs baseline: mean absolute channel difference and share of pixels that moved
// by more than 8/255. Catches regressions and verifies determinism (identical setup -> ~0).
async function diffStats(fileA, fileB) {
  const [a, b] = await Promise.all([fileA, fileB].map((f) => sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return { mean: null, changedPct: null, note: 'size mismatch' };
  let sum = 0, changed = 0;
  const n = a.info.width * a.info.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(a.data[o] - b.data[o]), Math.abs(a.data[o + 1] - b.data[o + 1]), Math.abs(a.data[o + 2] - b.data[o + 2]));
    sum += d; if (d > 8) changed++;
  }
  return { mean: Math.round((sum / n) * 1000) / 1000, changedPct: Math.round((changed / n) * 10000) / 100 };
}

async function composites() {
  const baseDir = join(capturesDir, 'baseline');
  const W = 640, H = 360;
  const diffs = {};
  for (const name of only) {
    const sc = cfg.scenarios[name];
    if (!sc) continue;
    for (const vpName of viewportNames) {
      const after = join(runDir, `${name}_${vpName}.png`);
      if (!existsSync(after)) continue;
      const before = join(baseDir, `${name}_${vpName}.png`);
      const ref = sc.reference ? join(refDir, sc.reference) : null;
      if (existsSync(before)) { diffs[`${name}_${vpName}`] = await diffStats(before, after); console.log(`${name.padEnd(20)} ${vpName.padEnd(6)} vs baseline: mean ${diffs[`${name}_${vpName}`].mean}  changed>8: ${diffs[`${name}_${vpName}`].changedPct}%`); }
      const panels = await Promise.all([
        panel(ref, W, H, ref && existsSync(ref) ? `reference: ${sc.reference}` : 'reference: (none yet)'),
        panel(existsSync(before) ? before : null, W, H, existsSync(before) ? 'baseline' : 'baseline: (none)'),
        panel(after, W, H, `this run: ${name} ${vpName}`),
      ]);
      await sharp({ create: { width: W * 3 + 8, height: H + 36, channels: 3, background: '#000' } })
        .composite(panels.map((p, i) => ({ input: p, left: i * (W + 4), top: 0 })))
        .png().toFile(join(runDir, 'composites', `${name}_${vpName}.png`));
    }
  }
  writeFileSync(join(runDir, 'diff.json'), JSON.stringify(diffs, null, 2));
  console.log(`composites -> ${join(runDir, 'composites')}`);
}

if (!flag('compare')) await capture();
await composites();
process.exit(0);
