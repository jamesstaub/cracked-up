/**
 * Meter maths. No Web Audio and no DOM here: these take blocks of samples and the time since the
 * last block, so they can be tested against signals rendered offline.
 */

/** What one block of samples measures as. */
export interface BlockStats {
  /** Largest absolute sample. */
  peak: number;
  /** Root of the mean of the squared samples. */
  rms: number;
  min: number;
  max: number;
  /** The newest sample. */
  last: number;
}

/** Decibels shown for silence. Nothing quieter than this is told apart. */
export const SILENCE_DB = -100;

/** Level in decibels relative to full scale (an amplitude of 1 is 0 dB), never below `SILENCE_DB`. */
export function toDb(amplitude: number): number {
  if (!(amplitude > 0)) return SILENCE_DB;
  return Math.max(SILENCE_DB, 20 * Math.log10(amplitude));
}

/** Measures a block. Pass `out` to reuse an object and allocate nothing. */
export function measure(samples: Float32Array, out?: BlockStats): BlockStats {
  const stats = out ?? { peak: 0, rms: 0, min: 0, max: 0, last: 0 };
  const length = samples.length;
  if (length === 0) {
    stats.peak = stats.rms = stats.min = stats.max = stats.last = 0;
    return stats;
  }
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    const value = samples[i]!;
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value * value;
  }
  // A block holding NaN (a filter that blew up) compares false everywhere; show it as silence.
  if (!(min <= max) || Number.isNaN(sum)) {
    stats.peak = stats.rms = stats.min = stats.max = stats.last = 0;
    return stats;
  }
  stats.min = min;
  stats.max = max;
  stats.peak = Math.max(-min, max);
  stats.rms = Math.sqrt(sum / length);
  stats.last = samples[length - 1]!;
  return stats;
}

/** How fast the peak reading falls once the signal drops, in decibels per second. */
export const PEAK_FALL_DB = 24;
/** Seconds the peak-hold mark stays before it starts to fall. */
export const PEAK_HOLD_SECONDS = 1;
/** Time constant of the RMS reading's smoothing, in seconds. */
export const RMS_SECONDS = 0.12;
/** The bottom of the drawn meter scale, in decibels. */
export const METER_FLOOR_DB = -60;

/**
 * A level meter for audio. Peak rises at once and falls at a steady rate; the hold mark keeps the
 * highest peak for a second; RMS is smoothed so it reads as loudness and not as a waveform.
 */
export class LevelMeter {
  peakDb = SILENCE_DB;
  rmsDb = SILENCE_DB;
  holdDb = SILENCE_DB;
  /** True from a block that went over full scale until the hold mark has fallen again. */
  clipped = false;
  private meanSquare = 0;
  private held = 0;

  update(stats: BlockStats, dt: number): void {
    const step = Math.max(0, dt);
    const peak = toDb(stats.peak);
    this.peakDb = Math.max(peak, this.peakDb - PEAK_FALL_DB * step, SILENCE_DB);

    const square = stats.rms * stats.rms;
    const keep = step > 0 ? Math.exp(-step / RMS_SECONDS) : 1;
    this.meanSquare = square + (this.meanSquare - square) * keep;
    this.rmsDb = toDb(Math.sqrt(this.meanSquare));

    if (peak >= this.holdDb) {
      this.holdDb = peak;
      this.held = 0;
      this.clipped = stats.peak > 1;
    } else {
      this.held += step;
      if (this.held > PEAK_HOLD_SECONDS) {
        this.holdDb = Math.max(peak, this.holdDb - PEAK_FALL_DB * step, SILENCE_DB);
        if (this.holdDb < 0) this.clipped = false;
      }
    }
  }

  /** With no signal to read (audio suspended): falls to silence at the usual rates. */
  idle(dt: number): void {
    this.update(SILENT, dt);
  }

  /** True when every reading is below the drawn scale, so there is nothing to draw. */
  get silent(): boolean {
    return this.peakDb <= METER_FLOOR_DB && this.holdDb <= METER_FLOOR_DB;
  }

  /** 0 at the bottom of the scale or below, 1 at -12 dB or above: how busy a connection looks. */
  get activity(): number {
    return clamp01((this.peakDb - METER_FLOOR_DB) / (-12 - METER_FLOOR_DB));
  }
}

const SILENT: BlockStats = { peak: 0, rms: 0, min: 0, max: 0, last: 0 };

/** Seconds a control signal's recent lowest and highest values are remembered. */
export const RANGE_HOLD_SECONDS = 2;

/**
 * A meter for control signals: an lfo, an envelope, a smoothed value. These are not sound, so decibels
 * say little about them (a 2 Hz wave reads as a level that pumps twice a second). This keeps the
 * current value and the range it has covered over the last two seconds.
 */
export class RangeMeter {
  value = 0;
  /** Lowest and highest values over the last `RANGE_HOLD_SECONDS`. */
  low = 0;
  high = 0;
  /** The largest distance from zero seen recently: what the drawn scale runs to, each side of zero. */
  scale = 0;
  private started = false;
  /** Recent blocks as [age in seconds, min, max], oldest first. */
  private history: [number, number, number][] = [];

  update(stats: BlockStats, dt: number): void {
    const step = Math.max(0, dt);
    this.value = stats.last;
    for (const entry of this.history) entry[0] += step;
    while (this.history.length > 0 && this.history[0]![0] > RANGE_HOLD_SECONDS) {
      this.history.shift();
    }
    this.history.push([0, stats.min, stats.max]);
    let low = Infinity;
    let high = -Infinity;
    for (const entry of this.history) {
      if (entry[1] < low) low = entry[1];
      if (entry[2] > high) high = entry[2];
    }
    this.low = low;
    this.high = high;
    const reach = Math.max(Math.abs(low), Math.abs(high));
    // The scale grows at once and shrinks slowly, so the drawing does not jump about.
    this.scale = this.started ? Math.max(reach, this.scale * Math.exp(-step / 4)) : reach;
    this.started = true;
  }

  idle(): void {
    // A suspended context produces nothing new; the last reading stays, which is what a paused
    // control signal is.
  }

  /** 0 for a value that is not moving, towards 1 as it covers more of its scale. */
  get activity(): number {
    if (!(this.scale > 0)) return 0;
    return clamp01((this.high - this.low) / this.scale);
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** A value with enough digits to read and no more: 0.0001, 0.0031, 0.25, 12.5, 440, 12000. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const size = Math.abs(value);
  if (size === 0) return '0';
  if (size >= 1000) return String(Math.round(value));
  if (size >= 100) return trimZeros(value.toFixed(1));
  if (size >= 1) return trimZeros(value.toFixed(2));
  if (size >= 1e-6) return String(Number(value.toPrecision(3)));
  return value.toExponential(1);
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** Decibels for display: one decimal, and "-inf" for silence. */
export function formatDb(db: number): string {
  return db <= SILENCE_DB ? '-inf' : db.toFixed(1);
}
