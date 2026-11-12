import { createEngine } from '../../src';
import type { Engine } from '../../src';
import { SAMPLE_RATE } from '../core/setup';

/** Magnitude of one frequency in a mono signal (a single-bin DFT), scaled so a sine of amplitude A reads A. */
export function goertzel(data: Float32Array, frequency: number, sampleRate = SAMPLE_RATE): number {
  let re = 0;
  let im = 0;
  const w = (2 * Math.PI * frequency) / sampleRate;
  for (let i = 0; i < data.length; i++) {
    re += (data[i] ?? 0) * Math.cos(w * i);
    im -= (data[i] ?? 0) * Math.sin(w * i);
  }
  return (2 * Math.hypot(re, im)) / data.length;
}

/** An offline engine with an explicit random seed. */
export async function seededEngine(seconds: number, seed: number): Promise<Engine> {
  const context = new OfflineAudioContext(1, Math.round(SAMPLE_RATE * seconds), SAMPLE_RATE);
  return createEngine({ context, seed });
}

/** The first channel of an audio buffer as a plain copy. */
export const samples = (buffer: AudioBuffer): Float32Array => buffer.getChannelData(0).slice();

/** True when two sample arrays are bit-identical. */
export function identical(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/** The largest absolute difference between two sample arrays over a range. */
export function maxDiff(a: Float32Array, b: Float32Array, from = 0, to = a.length): number {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return max;
}

/**
 * A drum pattern at 120 bpm made from arithmetic: a kick (a falling sine) on the odd beats, a snare
 * (noise and a tone) on the even ones, and a hat (bright noise) every eighth. The noise is seeded, so
 * the buffer is the same every time. Peaks at 0.95; RMS 0.123 over four seconds.
 */
export function drumLoop(seconds: number): AudioBuffer {
  let seed = 12345;
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  const length = Math.round(seconds * SAMPLE_RATE);
  const buffer = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: SAMPLE_RATE });
  const data = buffer.getChannelData(0);
  const add = (at: number, duration: number, fn: (t: number) => number) => {
    const start = Math.round(at * SAMPLE_RATE);
    for (let i = 0; i < duration * SAMPLE_RATE && start + i < length; i++) {
      data[start + i]! += fn(i / SAMPLE_RATE);
    }
  };
  for (let beat = 0; beat * 0.5 < seconds; beat++) {
    const t0 = beat * 0.5;
    if (beat % 2 === 0) {
      // 150 Hz falling to 50 Hz.
      const phase = (t: number) => 50 * t + (100 / 30) * (1 - Math.exp(-t * 30));
      add(t0, 0.3, (t) => 0.8 * Math.exp(-t * 12) * Math.sin(2 * Math.PI * phase(t)));
    } else {
      add(
        t0,
        0.2,
        (t) => 0.5 * Math.exp(-t * 25) * (0.7 * noise() + 0.5 * Math.sin(2 * Math.PI * 190 * t)),
      );
    }
    for (const offset of [0, 0.25]) {
      let last = 0;
      add(t0 + offset, 0.05, (t) => {
        const n = noise();
        const bright = n - last;
        last = n;
        return 0.15 * Math.exp(-t * 90) * bright;
      });
    }
  }
  return buffer;
}
