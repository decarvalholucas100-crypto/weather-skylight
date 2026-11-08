// Dev panel (D) and debug overlay (I). Plain DOM, no framework: it's a handful of sliders.
import { config, type ModeName, type QualityName } from './config';
import { MODES, type DevOverrides } from './state';
import type { SimClock } from './clock';
import type { CommandBus } from './input';

const css = `
.sk-panel{position:fixed;top:16px;right:16px;width:300px;max-height:calc(100vh - 32px);overflow:auto;
  background:rgba(12,14,20,.82);backdrop-filter:blur(8px);color:#e8ecf2;font:13px/1.35 system-ui,sans-serif;
  border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 16px;z-index:10;box-sizing:border-box}
.sk-panel h3{margin:0 0 10px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#9aa6b8;font-weight:600}
.sk-row{margin:10px 0}
.sk-row label{display:flex;justify-content:space-between;align-items:center;gap:8px}
.sk-row .v{font-variant-numeric:tabular-nums;color:#c8d2e0}
.sk-row input[type=range]{width:100%;margin:6px 0 0;accent-color:#7fb2ff}
.sk-row input[type=checkbox]{accent-color:#7fb2ff}
.sk-row.off input[type=range]{opacity:.35}
.sk-btns{display:flex;flex-wrap:wrap;gap:6px}
.sk-btns button{flex:1 1 auto;background:#1f2633;color:#dfe6f0;border:1px solid #2f3a4d;border-radius:8px;
  padding:6px 8px;font:inherit;cursor:pointer}
.sk-btns button.on{background:#2d5ea8;border-color:#4d86d9;color:#fff}
.sk-hint{color:#7d889a;font-size:12px;margin-top:12px}
.sk-overlay{position:fixed;left:12px;top:12px;z-index:9;color:#dfe6f0;font:12px/1.45 ui-monospace,Menlo,monospace;
  background:rgba(0,0,0,.55);padding:8px 10px;border-radius:8px;white-space:pre;pointer-events:none}
.sk-toast{position:fixed;left:50%;bottom:8%;transform:translateX(-50%);z-index:9;color:#fff;
  font:500 20px/1 system-ui,sans-serif;letter-spacing:.04em;background:rgba(0,0,0,.35);padding:12px 20px;
  border-radius:999px;opacity:0;transition:opacity .6s;pointer-events:none}
`;

export interface UiState {
  mode: ModeName;
  quality: QualityName;
  brightness: number;
  dev: DevOverrides;
}

interface SliderOpts { label: string; min: number; max: number; step: number; value: number; fmt: (v: number) => string; overridable: boolean }

export class Ui {
  private panel: HTMLDivElement;
  private overlay: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  private modeBtns = new Map<ModeName, HTMLButtonElement>();
  private qualityBtns = new Map<QualityName, HTMLButtonElement>();
  private timeSlider!: { input: HTMLInputElement; val: HTMLSpanElement; row: HTMLDivElement; check: HTMLInputElement | null };
  private brightSlider!: { input: HTMLInputElement; val: HTMLSpanElement };
  onQuality?: (q: QualityName) => void;

  constructor(private state: UiState, private clock: SimClock, private bus: CommandBus) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    this.overlay = document.createElement('div');
    this.overlay.className = 'sk-overlay';
    this.overlay.style.display = 'none';
    document.body.appendChild(this.overlay);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'sk-toast';
    document.body.appendChild(this.toastEl);

    this.panel = document.createElement('div');
    this.panel.className = 'sk-panel';
    this.panel.style.display = 'none';
    document.body.appendChild(this.panel);
    this.buildPanel();
  }

  private slider(parent: HTMLElement, o: SliderOpts, onChange: (v: number | undefined) => void) {
    const row = document.createElement('div');
    row.className = 'sk-row' + (o.overridable ? ' off' : '');
    const label = document.createElement('label');
    const left = document.createElement('span');
    let check: HTMLInputElement | null = null;
    if (o.overridable) {
      check = document.createElement('input');
      check.type = 'checkbox';
      check.title = 'Override live value';
      left.append(check, ' ');
    }
    left.append(o.label);
    const val = document.createElement('span');
    val.className = 'v';
    val.textContent = o.overridable ? 'live' : o.fmt(o.value);
    label.append(left, val);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(o.min); input.max = String(o.max); input.step = String(o.step); input.value = String(o.value);
    row.append(label, input);
    parent.appendChild(row);
    const emit = () => {
      const on = !check || check.checked;
      row.classList.toggle('off', !on);
      const v = Number(input.value);
      val.textContent = on ? o.fmt(v) : 'live';
      onChange(on ? v : undefined);
    };
    input.addEventListener('input', () => { if (check && !check.checked) check.checked = true; emit(); });
    check?.addEventListener('change', emit);
    return { input, val, row, check, emit };
  }

  private buttons<T extends string>(parent: HTMLElement, items: [T, string][], onClick: (k: T) => void, store: Map<T, HTMLButtonElement>) {
    const wrap = document.createElement('div');
    wrap.className = 'sk-btns';
    for (const [k, label] of items) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => onClick(k));
      store.set(k, b);
      wrap.appendChild(b);
    }
    parent.appendChild(wrap);
  }

  private section(title: string): HTMLDivElement {
    const s = document.createElement('div');
    const h = document.createElement('h3');
    h.textContent = title;
    h.style.marginTop = this.panel.childElementCount ? '16px' : '0';
    s.appendChild(h);
    this.panel.appendChild(s);
    return s;
  }

  private buildPanel(): void {
    const dev = this.state.dev;
    const modes = this.section('Mode');
    this.buttons(modes, config.modeOrder.map((m) => [m, MODES[m].label] as [ModeName, string]), (m) => this.bus.emit({ type: 'mode.set', mode: m }), this.modeBtns);

    const time = this.section('Time');
    const fmtTime = (h: number) => {
      const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    };
    this.timeSlider = this.slider(time, { label: 'Time of day', min: 0, max: 23.99, step: 0.05, value: this.clock.timeOfDayHours(), fmt: fmtTime, overridable: true }, (v) => {
      if (v === undefined) this.clock.resetToReal();
      else this.clock.setTimeOfDay(v);
    });
    const speeds: [string, string][] = [['1', '1×'], ['60', '60×'], ['600', '600×'], ['3600', '1 h/s']];
    const speedBtns = new Map<string, HTMLButtonElement>();
    this.buttons(time, speeds, (s) => {
      this.clock.timeScale = Number(s);
      speedBtns.forEach((b, k) => b.classList.toggle('on', k === s));
    }, speedBtns);
    speedBtns.get('1')?.classList.add('on');
    const resetWrap = document.createElement('div');
    resetWrap.className = 'sk-btns';
    resetWrap.style.marginTop = '6px';
    const reset = document.createElement('button');
    reset.textContent = 'Back to real time';
    reset.onclick = () => {
      this.clock.resetToReal();
      speedBtns.forEach((b, k) => b.classList.toggle('on', k === '1'));
      if (this.timeSlider.check) { this.timeSlider.check.checked = false; }
      this.timeSlider.row.classList.add('off');
      this.timeSlider.val.textContent = 'live';
    };
    resetWrap.appendChild(reset);
    time.appendChild(resetWrap);

    const wx = this.section('Weather overrides');
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    this.slider(wx, { label: 'Cloud cover', min: 0, max: 1, step: 0.01, value: 0.4, fmt: pct, overridable: true }, (v) => { dev.cloud = v; });
    this.slider(wx, { label: 'Rain', min: 0, max: 1, step: 0.01, value: 0.5, fmt: pct, overridable: true }, (v) => { dev.rain = v; });
    this.slider(wx, { label: 'Wind (cloud level)', min: 0, max: 40, step: 0.5, value: 8, fmt: (v) => `${v.toFixed(1)} m/s`, overridable: true }, (v) => { dev.windSpeed = v; });
    const compass = (v: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(v / 45) % 8] + ` ${Math.round(v)}°`;
    this.slider(wx, { label: 'Wind toward', min: 0, max: 359, step: 1, value: 90, fmt: compass, overridable: true }, (v) => { dev.windToDeg = v; });
    this.slider(wx, { label: 'Lightning', min: 0, max: 1, step: 1, value: 1, fmt: (v) => (v ? 'on' : 'off'), overridable: true }, (v) => { dev.lightning = v === undefined ? undefined : v > 0.5; });

    const disp = this.section('Display');
    this.brightSlider = this.slider(disp, { label: 'Brightness', min: config.brightness.min, max: config.brightness.max, step: 0.05, value: this.state.brightness, fmt: pct, overridable: false }, (v) => {
      if (v !== undefined) this.bus.emit({ type: 'brightness.set', value: v });
    });
    this.buttons(disp, [['high', 'High'], ['medium', 'Medium (Pi)'], ['low', 'Low']] as [QualityName, string][], (q) => this.onQuality?.(q), this.qualityBtns);

    const hint = document.createElement('div');
    hint.className = 'sk-hint';
    hint.innerHTML = 'Keys: <b>M</b>/<b>N</b> or ←/→ mode · <b>1-6</b> pick mode · ↑/↓ brightness · <b>D</b> this panel · <b>I</b> debug · <b>F</b> fullscreen';
    this.panel.appendChild(hint);
    this.sync();
  }

  sync(): void {
    this.modeBtns.forEach((b, k) => b.classList.toggle('on', k === this.state.mode));
    this.qualityBtns.forEach((b, k) => b.classList.toggle('on', k === this.state.quality));
    this.brightSlider.input.value = String(this.state.brightness);
    this.brightSlider.val.textContent = `${Math.round(this.state.brightness * 100)}%`;
  }

  tickTimeSlider(): void {
    if (this.panel.style.display === 'none') return;
    if (this.timeSlider.check?.checked && document.activeElement !== this.timeSlider.input) {
      const h = this.clock.timeOfDayHours();
      this.timeSlider.input.value = String(h);
      const hh = Math.floor(h), mm = Math.floor((h % 1) * 60);
      this.timeSlider.val.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }

  toggleDev(force?: boolean): void {
    const show = force ?? this.panel.style.display === 'none';
    this.panel.style.display = show ? 'block' : 'none';
    if (show) this.sync();
  }

  toggleDebug(force?: boolean): void {
    const show = force ?? this.overlay.style.display === 'none';
    this.overlay.style.display = show ? 'block' : 'none';
  }

  get debugVisible(): boolean {
    return this.overlay.style.display !== 'none';
  }

  setOverlay(text: string): void {
    this.overlay.textContent = text;
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.style.opacity = '0'), 1600);
  }
}
