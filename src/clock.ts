import { config } from './config';

/** Minutes the installation's time zone is ahead of UTC at a given instant. */
function tzOffsetMinutes(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.location.timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

// Simulated clock. Normally equals real time; the dev panel can jump to a time of day
// or run time faster so every condition can be previewed.
export class SimClock {
  private simMs = Date.now();
  private lastReal = performance.now();
  /** Multiplier on the passage of time. 1 = real time. */
  timeScale = 1;
  /** Whether the clock is locked to real time (no offset, scale 1). */
  get isLive(): boolean {
    return this.timeScale === 1 && Math.abs(this.simMs - Date.now()) < 2000;
  }

  tick(): number {
    const now = performance.now();
    const dtReal = Math.min(0.25, (now - this.lastReal) / 1000);
    this.lastReal = now;
    this.simMs += dtReal * 1000 * this.timeScale;
    return dtReal;
  }

  now(): Date {
    return new Date(this.simMs);
  }

  /** Jump to a time of day (hours, 0..24) at the installation's location, on the current simulated date. */
  setTimeOfDay(hours: number): void {
    const off = tzOffsetMinutes(this.simMs) * 60_000;
    const localMidnight = Math.floor((this.simMs + off) / 86400_000) * 86400_000;
    this.simMs = localMidnight - off + hours * 3600_000;
  }

  /** Time of day (hours) at the installation's location. */
  timeOfDayHours(): number {
    const off = tzOffsetMinutes(this.simMs) * 60_000;
    return (((this.simMs + off) % 86400_000) + 86400_000) % 86400_000 / 3600_000;
  }

  /** Human-readable local time at the installation. */
  label(): string {
    return new Date(this.simMs).toLocaleString('en-US', { timeZone: config.location.timeZone, dateStyle: 'medium', timeStyle: 'short' });
  }

  /** Fix the simulated date (YYYY-MM-DD, local to the installation); time of day is kept. */
  setDate(iso: string): void {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return;
    const hours = this.timeOfDayHours();
    // Noon UTC on that date, then setTimeOfDay places the local hour on the right civil day.
    this.simMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    this.setTimeOfDay(hours);
  }

  resetToReal(): void {
    this.simMs = Date.now();
    this.timeScale = 1;
  }
}
