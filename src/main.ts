import { altOf } from './astro';
import { SimClock } from './clock';
import { config, type ModeName, type QualityName } from './config';
import { attachControlSocket, attachKeyboard, CommandBus } from './input';
import { computeLighting } from './lighting';
import { Renderer } from './render/renderer';
import { planetRows } from './planets';
import { buildTarget, cloneParams, computeAstro, describeClouds, easeParams, MODES, type DevOverrides, type SkyParams } from './state';
import { Ui, type UiState } from './ui';
import { loadCachedWeather, startWeatherPolling, type Weather } from './weather';
import { getPlace, initLocation, loadCachedPlace, onPlaceChange } from './location';

// ---- URL parameters: handy for testing on the TV, e.g. ?mode=storm&q=medium&t=19.5 ----
const qs = new URLSearchParams(location.search);
const numParam = (k: string) => (qs.has(k) && Number.isFinite(Number(qs.get(k))) ? Number(qs.get(k)) : undefined);

const clock = new SimClock();
const bus = new CommandBus();
const dev: DevOverrides = {
  cloud: numParam('cloud'),
  rain: numParam('rain'),
  windSpeed: numParam('wind'),
  windToDeg: numParam('windto'),
  lightning: qs.has('lightning') ? qs.get('lightning') !== '0' : undefined,
  mid: numParam('mid'),
  high: numParam('high'),
};
if (numParam('t') !== undefined) clock.setTimeOfDay(numParam('t')!);
if (numParam('speed') !== undefined) clock.timeScale = numParam('speed')!;
const urlMode = qs.get('mode') as ModeName | null;
const urlQuality = qs.get('q') as QualityName | null;
if (numParam('fov') !== undefined) config.fovDeg = numParam('fov')!;

const state: UiState = {
  mode: urlMode && urlMode in MODES ? urlMode : config.defaultMode,
  quality: urlQuality && urlQuality in config.quality ? urlQuality : config.defaultQuality,
  brightness: config.brightness.initial,
  dev,
};

let weather: Weather | null = loadCachedWeather();
let weatherStatus = weather ? 'cached' : 'waiting';
// Weather and mode changes set how quickly the scene eases to its new target.
let weatherTau = 4;
const astroTau = 2.5;

const canvas = document.getElementById('sky') as HTMLCanvasElement;
let renderer: Renderer;
try {
  renderer = new Renderer(canvas, config.quality[state.quality]);
} catch (e) {
  // Never show an error on the display itself; log for whoever is debugging.
  console.error(e);
  throw e;
}
const ui = new Ui(state, clock, bus);
ui.onQuality = (q) => {
  state.quality = q;
  renderer.setQuality(config.quality[q]);
  ui.sync();
};
if (qs.has('dev')) ui.toggleDev(true);
if (qs.has('debug')) ui.toggleDebug(true);

attachKeyboard(bus);
const wsParam = qs.get('ws');
if (config.controlSocket.enabled || wsParam) {
  attachControlSocket(bus, wsParam && wsParam !== '1' ? wsParam : config.controlSocket.url);
}

bus.on((c) => {
  const order = config.modeOrder;
  switch (c.type) {
    case 'mode.next':
    case 'mode.prev': {
      const i = order.indexOf(state.mode);
      state.mode = order[(i + (c.type === 'mode.next' ? 1 : order.length - 1)) % order.length];
      weatherTau = 5;
      ui.toast(MODES[state.mode].label);
      break;
    }
    case 'mode.set':
      state.mode = c.mode;
      weatherTau = 5;
      ui.toast(MODES[state.mode].label);
      break;
    case 'brightness.up':
    case 'brightness.down':
    case 'brightness.set': {
      const b = config.brightness;
      const v = c.type === 'brightness.set' ? c.value : state.brightness + (c.type === 'brightness.up' ? b.step : -b.step);
      state.brightness = Math.min(b.max, Math.max(b.min, Math.round(v * 100) / 100));
      if (c.type !== 'brightness.set') ui.toast(`Brightness ${Math.round(state.brightness * 100)}%`);
      break;
    }
    case 'dev.toggle':
      ui.toggleDev();
      break;
    case 'debug.toggle':
      ui.toggleDebug();
      break;
    case 'fullscreen.toggle':
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.().catch(() => {});
      break;
  }
  ui.sync();
});

// Use the last known browser location before the first weather request goes out.
loadCachedPlace(qs.get('geo') !== '0');
const weatherPoll = startWeatherPolling(
  (w) => {
    const first = !weather;
    weather = w;
    weatherTau = first ? (qs.has("snap") ? 0.05 : 3) : config.weather.easeSeconds;
  },
  (s) => { weatherStatus = s; },
);

// Real location: ask the browser once (?geo=0 to skip). When it changes, re-fetch weather for
// the new spot right away; sun, moon and stars follow automatically (they read config.location).
onPlaceChange(() => { weatherPoll.refresh(); });
initLocation(qs.get('geo') !== '0');

// Hide the cursor when idle (it's a ceiling display).
let idleTimer = 0;
const wake = () => {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => document.body.classList.add('idle'), 2500);
};
window.addEventListener('mousemove', wake);
wake();
canvas.addEventListener('dblclick', () => bus.emit({ type: 'fullscreen.toggle' }));

// ---- simulation state ----
let astro = computeAstro(clock.now());
const current: SkyParams = cloneParams(buildTarget(state.mode, astro, weather, dev));
let devSnapshot = JSON.stringify(dev);
const P = 76800; // common period of the low/mid cloud noise (m): wrapping here is seamless
const windLow: [number, number] = [0, 0];
const windMid: [number, number] = [0, 0];
const windHigh: [number, number] = [0, 0];
let cloudTime = 0;
let wet = current.rain > 0.02 ? 1 : 0;
let flash = 0;
let flashPos: [number, number] = [0, 0];
let flashT = -1;
let nextStrike = 4 + Math.random() * 8;
let frames = 0, fpsAcc = 0, fps = 0;
let lastAstro = 0;
const wrap = (v: number, m: number) => ((v % m) + m) % m;

function frame(): void {
  const dt = clock.tick();
  const simDt = dt * clock.timeScale;
  const now = performance.now();

  // Sun/moon: recompute ~10x per second (cheap, and they move slowly).
  if (now - lastAstro > 100 || clock.timeScale > 1) {
    astro = computeAstro(clock.now());
    renderer.setPlanets(planetRows(clock.now()));
    lastAstro = now;
  }
  const devNow = JSON.stringify(dev);
  if (devNow !== devSnapshot) { devSnapshot = devNow; weatherTau = 1.5; }

  const target = buildTarget(state.mode, astro, weather, dev);
  easeParams(current, target, dt, clock.timeScale > 1 ? 0.3 : astroTau, weatherTau);

  // Clouds drift with the (eased) wind; higher layers move faster.
  const wx = current.windX, wy = current.windY;
  windLow[0] = wrap(windLow[0] + wx * simDt, P); windLow[1] = wrap(windLow[1] + wy * simDt, P);
  windMid[0] = wrap(windMid[0] + wx * 1.4 * simDt, P); windMid[1] = wrap(windMid[1] + wy * 1.4 * simDt, P);
  windHigh[0] = wrap(windHigh[0] + wx * 2.0 * simDt, 1e6); windHigh[1] = wrap(windHigh[1] + wy * 2.0 * simDt, 1e6);
  cloudTime = wrap(cloudTime + simDt, 1250);
  const ws = Math.hypot(wx, wy) || 1;

  // Glass wetness: wets quickly when rain starts, dries over a few minutes after it stops.
  const wetTarget = current.rain > 0.03 ? 1 : 0;
  wet += (wetTarget - wet) * (1 - Math.exp(-dt / (wetTarget > wet ? 6 : 150)));

  // Lightning: random strikes, each a quick burst of 2-4 flickers.
  nextStrike -= dt;
  if (current.lightning > 0.05 && nextStrike <= 0) {
    flashT = 0;
    flashPos = [(Math.random() - 0.5) * 6000, (Math.random() - 0.5) * 6000];
    nextStrike = (6 + Math.random() * 16) / current.lightning;
  }
  if (flashT >= 0) {
    flashT += dt;
    const t = flashT;
    flash = Math.max(0, Math.exp(-((t - 0.02) ** 2) / 0.0008), 0.7 * Math.exp(-((t - 0.16) ** 2) / 0.0012), 0.5 * Math.exp(-((t - 0.33) ** 2) / 0.003)) * current.lightning;
    if (t > 0.7) { flashT = -1; flash = 0; }
  }

  renderer.history = clock.timeScale > 30 ? 0.3 : clock.timeScale > 1 ? 0.6 : 0.8;
  const L = computeLighting(current);
  if (qs.has('nolight')) { L.lightLow = [0, 0, 0]; }
  if (qs.has('noamb')) { L.ambTop = [0, 0, 0]; L.ambBottom = [0, 0, 0]; }
  renderer.render({
    sunDir: current.sunDir,
    moonDir: current.moonDir,
    lightDir: L.lightDir,
    lightLow: L.lightLow, lightMid: L.lightMid, lightHigh: L.lightHigh,
    ambTop: L.ambTop.map((v) => v + flash * 0.25) as typeof L.ambTop,
    ambBottom: L.ambBottom,
    sunDisk: L.sunDisk, nightSky: L.nightSky, moonGlow: L.moonGlow, moonColor: L.moonColor, moonGlowAmt: L.moonGlowAmt,
    fogColor: L.fogColor.map((v) => v + flash * 0.15) as typeof L.fogColor,
    glassTint: L.glassTint,
    exposure: L.exposure, mieScale: L.mieScale,
    coverLow: current.cloudLow, coverMid: current.cloudMid, coverHigh: current.cloudHigh,
    lowBase: current.lowBase, convective: current.convective, towers: current.towers, underDeck: L.underDeck,
    scud: Math.min(1, Math.max(current.storminess - 0.3, current.rain * 0.9) * Math.min(1, current.cloudLow * 1.2)),
    storm: current.storminess, rain: current.rain, wet, haze: current.haze,
    cloudTime, realTime: (now / 1000) % 3600,
    windLow, windMid, windHigh, windDir: [wx / ws, wy / ws],
    flash, flashPos,
    brightness: state.brightness,
    worldToEq: astro.worldToEq,
    starLimitMag: L.starLimitMag, starVis: L.starVis,
  });

  // FPS + overlay + dynamic resolution
  frames++; fpsAcc += dt;
  if (fpsAcc >= 0.5) {
    fps = frames / fpsAcc; frames = 0; fpsAcc = 0;
    if (!document.hidden && now > 4000) {
      const target = config.targetFps[state.quality];
      const k = renderer.dynamicScale;
      if (fps < target * 0.9) renderer.setDynamicScale(k * 0.9);
      else if (fps > target * 1.12 && k < 1) renderer.setDynamicScale(k * 1.05);
    }
  }
  if (ui.debugVisible && frames === 0) {
    const [iw, ih] = renderer.internalSize;
    const w = weather;
    ui.setOverlay([
      `version    v${__APP_VERSION__}  build ${__BUILD_SHA__}  ${__BUILD_TIME__}`,
      `fps        ${fps.toFixed(1)}`,
      `mode       ${MODES[state.mode].label}   quality ${state.quality}`,
      `output     ${renderer.outW}x${renderer.outH}   sky ${iw}x${ih} (dyn ${Math.round(renderer.dynamicScale * 100)}%)`,
      `sim time   ${clock.label()}  x${clock.timeScale}`,
      `sun alt    ${altOf(current.sunDir).toFixed(1)}°   moon ${altOf(current.moonDir).toFixed(1)}° (${Math.round(current.moonFraction * 100)}% lit)`,
      `clouds     low ${pct(current.cloudLow)} mid ${pct(current.cloudMid)} high ${pct(current.cloudHigh)} storm ${pct(current.storminess)}`,
      `rain       ${pct(current.rain)}  glass wet ${pct(wet)}  haze ${pct(current.haze)}`,
      `wind       ${Math.hypot(wx, wy).toFixed(1)} m/s toward ${Math.round((Math.atan2(wx, wy) * 180) / Math.PI + 360) % 360}°`,
      `weather    ${weatherStatus}${w ? `  @ ${new Date(w.fetchedAt).toLocaleTimeString()}  code ${w.weatherCode}  cloud ${pct(w.cloudTotal)}  precip ${w.precipitation}mm  wind ${w.windSpeed}m/s from ${w.windFromDeg}°  vis ${(w.visibility / 1000).toFixed(1)}km` : ''}`,
      `location   ${(() => { const pl = getPlace(); return `${pl.lat.toFixed(3)}, ${pl.lon.toFixed(3)}  (${pl.source === 'browser' ? `browser fix ±${pl.accuracyM} m` : pl.source === 'cached' ? 'last browser fix' : config.location.name})  ${pl.timeZone}`; })()}`,
      `temp       ${fmtTemp(w?.tempC ?? w?.metar?.tempC ?? null)}${w?.metar ? `   station ${w.metar.station}${w.metar.distanceKm != null ? ` (${w.metar.distanceKm} km)` : ''}` : ''}`,
      `cape       ${w ? `${Math.round(w.cape ?? 0)} J/kg  lifted index ${(w.liftedIndex ?? 0).toFixed(1)}` : '-'}`,
      `metar      ${w?.metar ? `${w.metar.raw}` : 'unavailable (using Open-Meteo layers)'}`,
      `cloud type ${describeClouds(current)}`,
    ].join('\n'));
  }
  ui.tickTimeSlider();
  requestAnimationFrame(frame);
}

const fmtTemp = (c: number | null) => (c == null ? '-' : `${Math.round(c * 9 / 5 + 32)}°F / ${Math.round(c)}°C`);
const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(4);

// Fade in from black on load.
canvas.style.opacity = '0';
canvas.style.transition = 'opacity 1.5s ease';
requestAnimationFrame(() => { canvas.style.opacity = '1'; frame(); });
