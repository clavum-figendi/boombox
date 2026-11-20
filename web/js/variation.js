/** Playback-time cadence. A delayed tick emits once, never catches up in bursts. */
export class VariationClock {
  constructor({minutes = 5, enabled = false} = {}) {
    this.minutes = 5;
    this.enabled = false;
    this.configure({minutes, enabled});
  }
  configure({minutes = this.minutes, enabled = this.enabled} = {}) {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < .1 || minutes > 120) throw new RangeError('Variation minutes must be between 0.1 and 120.');
    if (typeof enabled !== 'boolean') throw new TypeError('Variation enabled must be boolean.');
    if (minutes !== this.minutes || enabled !== this.enabled || this.remaining === undefined) {
      this.minutes = minutes;
      this.enabled = enabled;
      this.reset();
    }
  }
  reset() { this.remaining = this.minutes * 60; }
  advance(seconds, playing) {
    if (!Number.isFinite(seconds) || seconds < 0 || !playing || !this.enabled) return false;
    this.remaining = Math.max(0, this.remaining - seconds);
    if (this.remaining > 0) return false;
    this.reset();
    return true;
  }
}
