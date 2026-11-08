// Input layer. Every control source (keyboard today, rotary encoder on the Pi later)
// produces the same small set of string commands. The app only listens to commands.
import { config, type ModeName } from './config';

export type Command =
  | { type: 'mode.next' }
  | { type: 'mode.prev' }
  | { type: 'mode.set'; mode: ModeName }
  | { type: 'brightness.up' }
  | { type: 'brightness.down' }
  | { type: 'brightness.set'; value: number }
  | { type: 'dev.toggle' }
  | { type: 'debug.toggle' }
  | { type: 'fullscreen.toggle' };

type Listener = (c: Command) => void;

export class CommandBus {
  private listeners: Listener[] = [];
  on(fn: Listener): void {
    this.listeners.push(fn);
  }
  emit(c: Command): void {
    for (const l of this.listeners) l(c);
  }
}

/** Parse a text command, e.g. "mode.next", "mode.set storm", "brightness.set 0.8". */
export function parseCommand(text: string): Command | null {
  const [name, arg] = text.trim().split(/\s+/, 2);
  switch (name) {
    case 'mode.next':
    case 'mode.prev':
    case 'brightness.up':
    case 'brightness.down':
    case 'dev.toggle':
    case 'debug.toggle':
    case 'fullscreen.toggle':
      return { type: name };
    case 'mode.set':
      return config.modeOrder.includes(arg as ModeName) ? { type: 'mode.set', mode: arg as ModeName } : null;
    case 'brightness.set': {
      const v = Number(arg);
      return Number.isFinite(v) ? { type: 'brightness.set', value: v } : null;
    }
    // Rotary encoder conveniences: turning = brightness, press = next mode.
    case 'rotary.cw':
      return { type: 'brightness.up' };
    case 'rotary.ccw':
      return { type: 'brightness.down' };
    case 'rotary.press':
      return { type: 'mode.next' };
  }
  return null;
}

export function attachKeyboard(bus: CommandBus): void {
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const map: Record<string, Command> = {
      m: { type: 'mode.next' },
      ArrowRight: { type: 'mode.next' },
      n: { type: 'mode.prev' },
      ArrowLeft: { type: 'mode.prev' },
      ArrowUp: { type: 'brightness.up' },
      '=': { type: 'brightness.up' },
      '+': { type: 'brightness.up' },
      ArrowDown: { type: 'brightness.down' },
      '-': { type: 'brightness.down' },
      d: { type: 'dev.toggle' },
      '`': { type: 'debug.toggle' },
      i: { type: 'debug.toggle' },
      f: { type: 'fullscreen.toggle' },
    };
    const digit = Number(e.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= config.modeOrder.length) {
      bus.emit({ type: 'mode.set', mode: config.modeOrder[digit - 1] });
      return;
    }
    const cmd = map[e.key];
    if (cmd) {
      e.preventDefault();
      bus.emit(cmd);
    }
  });
}

/**
 * Optional WebSocket control channel. A helper on the Pi (reading the rotary encoder over GPIO)
 * runs a tiny WebSocket server and sends one text command per message. Silent reconnects;
 * never surfaces errors on screen.
 */
export function attachControlSocket(bus: CommandBus, url: string): void {
  let delay = 2000;
  const connect = () => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      setTimeout(connect, delay);
      return;
    }
    ws.onopen = () => { delay = 2000; };
    ws.onmessage = (ev) => {
      const cmd = parseCommand(String(ev.data));
      if (cmd) bus.emit(cmd);
    };
    ws.onclose = () => {
      setTimeout(connect, delay);
      delay = Math.min(30000, delay * 1.5);
    };
    ws.onerror = () => ws.close();
  };
  connect();
}
