import { describe, expect, it } from 'vitest';
import {
  LevelMeter,
  PEAK_FALL_DB,
  RangeMeter,
  SILENCE_DB,
  formatDb,
  formatNumber,
  measure,
  toDb,
} from '../../src/inspect/meter';
import { SAMPLE_RATE, constant, offlineEngine } from '../core/setup';

const BLOCK = 1024;
const DT = BLOCK / SAMPLE_RATE;

/** The blocks a tap would read from a rendered signal, one after another. */
function blocks(audio: AudioBuffer, from = 0): Float32Array[] {
  const data = audio.getChannelData(0);
  const out: Float32Array[] = [];
  for (let start = from; start + BLOCK <= data.length; start += BLOCK) {
    out.push(data.subarray(start, start + BLOCK));
  }
  return out;
}

describe('measure', () => {
  it('reads the peak and RMS of a rendered sine', async () => {
    const engine = await offlineEngine(0.5);
    engine.chain().sine(440).gain(0.5).to('main');
    const audio = await engine.render();
    const stats = measure(audio.getChannelData(0).subarray(4800, 4800 + 4800));
    expect(stats.peak).toBeCloseTo(0.5, 3);
    expect(stats.max).toBeCloseTo(0.5, 3);
    expect(stats.min).toBeCloseTo(-0.5, 3);
    // A sine's RMS is its peak over the square root of two.
    expect(stats.rms).toBeCloseTo(0.5 / Math.SQRT2, 3);
    expect(toDb(stats.peak)).toBeCloseTo(-6.02, 1);
    expect(toDb(stats.rms)).toBeCloseTo(-9.03, 1);
  });

  it('reads a constant as its own value', async () => {
    const engine = await offlineEngine(0.1);
    constant(engine, 0.1).gain(-0.25).to('main');
    const stats = measure((await engine.render()).getChannelData(0).subarray(1000, 2024));
    expect(stats).toEqual({ peak: 0.25, rms: 0.25, min: -0.25, max: -0.25, last: -0.25 });
  });

  it('reads silence, nothing at all, and a block of NaN as silence', () => {
    const zero = { peak: 0, rms: 0, min: 0, max: 0, last: 0 };
    expect(measure(new Float32Array(64))).toEqual(zero);
    expect(measure(new Float32Array(0))).toEqual(zero);
    expect(measure(new Float32Array([0.5, Number.NaN, 0.1]))).toEqual(zero);
    expect(toDb(0)).toBe(SILENCE_DB);
    expect(toDb(1)).toBe(0);
    expect(toDb(1e-9)).toBe(SILENCE_DB);
  });

  it('reuses the object it is given', () => {
    const out = { peak: 9, rms: 9, min: 9, max: 9, last: 9 };
    expect(measure(new Float32Array([0.5, -1]), out)).toBe(out);
    expect(out.peak).toBe(1);
    expect(out.last).toBe(-1);
  });
});

describe('LevelMeter', () => {
  it('settles on the level of a steady sine', async () => {
    const engine = await offlineEngine(1);
    engine.chain().sine(440).gain(0.5).to('main');
    const meter = new LevelMeter();
    for (const block of blocks(await engine.render())) meter.update(measure(block), DT);
    expect(meter.peakDb).toBeCloseTo(-6.02, 1);
    expect(meter.holdDb).toBeCloseTo(-6.02, 1);
    expect(meter.rmsDb).toBeCloseTo(-9.03, 1);
    expect(meter.clipped).toBe(false);
    expect(meter.silent).toBe(false);
    // -6 dB on a scale that runs from -60 dB to full brightness at -12 dB.
    expect(meter.activity).toBe(1);
  });

  it('lets the peak fall at a fixed rate and holds the highest peak for a second', () => {
    const meter = new LevelMeter();
    const loud = measure(new Float32Array(BLOCK).fill(0.5));
    const quiet = measure(new Float32Array(BLOCK));
    meter.update(loud, DT);
    expect(meter.peakDb).toBeCloseTo(-6.02, 2);

    // Half a second of silence: the peak has fallen 12 dB, the hold mark has not moved.
    for (let t = 0; t < 0.5 - 1e-9; t += 0.01) meter.update(quiet, 0.01);
    expect(meter.peakDb).toBeCloseTo(-6.02 - PEAK_FALL_DB * 0.5, 1);
    expect(meter.holdDb).toBeCloseTo(-6.02, 2);

    // Another second: the hold mark let go half a second ago and has fallen 12 dB too.
    for (let t = 0; t < 1 - 1e-9; t += 0.01) meter.update(quiet, 0.01);
    expect(meter.holdDb).toBeCloseTo(-6.02 - PEAK_FALL_DB * 0.5, 0);
    expect(meter.rmsDb).toBeLessThan(-60);

    // And in the end everything reads as silent.
    for (let t = 0; t < 5; t += 0.05) meter.idle(0.05);
    expect(meter.peakDb).toBe(SILENCE_DB);
    expect(meter.holdDb).toBe(SILENCE_DB);
    expect(meter.rmsDb).toBe(SILENCE_DB);
    expect(meter.silent).toBe(true);
    expect(meter.activity).toBe(0);
  });

  it('flags a block that reaches full scale until the hold mark falls', () => {
    const meter = new LevelMeter();
    meter.update(measure(new Float32Array(BLOCK).fill(1.2)), DT);
    expect(meter.clipped).toBe(true);
    expect(meter.holdDb).toBeGreaterThan(0);
    for (let t = 0; t < 1.5; t += 0.05) meter.idle(0.05);
    expect(meter.clipped).toBe(false);
  });

  it('shows a quiet signal as a little activity and a loud one as a lot', () => {
    const at = (amplitude: number): number => {
      const meter = new LevelMeter();
      meter.update(measure(new Float32Array(BLOCK).fill(amplitude)), DT);
      return meter.activity;
    };
    expect(at(0.0005)).toBe(0);
    expect(at(0.01)).toBeCloseTo(20 / 48, 2);
    expect(at(0.5)).toBe(1);
  });
});

describe('RangeMeter', () => {
  it('reads the swing of an lfo as a range, not as a level', async () => {
    const engine = await offlineEngine(1.5);
    // An lfo sent to the output so it can be rendered: 2 Hz, 100 each side of zero.
    engine.chain().lfo({ frequency: 2, depth: 100 }).to('main');
    const audio = await engine.render();
    const meter = new RangeMeter();
    for (const block of blocks(audio)) meter.update(measure(block), DT);
    expect(meter.high).toBeCloseTo(100, 0);
    expect(meter.low).toBeCloseTo(-100, 0);
    expect(meter.scale).toBeCloseTo(100, 0);
    expect(meter.activity).toBe(1);
    expect(meter.value).toBe(audio.getChannelData(0)[blocks(audio).length * BLOCK - 1]);
  });

  it('reads a steady value as a value that is not moving', async () => {
    const engine = await offlineEngine(0.5);
    constant(engine, 0.5).gain(0.3).to('main');
    const meter = new RangeMeter();
    for (const block of blocks(await engine.render(), BLOCK)) meter.update(measure(block), DT);
    expect(meter.value).toBeCloseTo(0.3, 6);
    expect(meter.low).toBeCloseTo(0.3, 6);
    expect(meter.high).toBeCloseTo(0.3, 6);
    expect(meter.scale).toBeCloseTo(0.3, 6);
    expect(meter.activity).toBe(0);
  });

  it('forgets a swing two seconds after it stopped', () => {
    const meter = new RangeMeter();
    meter.update({ peak: 1, rms: 1, min: -1, max: 1, last: 0 }, 0.1);
    expect(meter.activity).toBe(1);
    for (let t = 0; t < 2.2; t += 0.1) {
      meter.update({ peak: 0.5, rms: 0.5, min: 0.5, max: 0.5, last: 0.5 }, 0.1);
    }
    expect(meter.low).toBe(0.5);
    expect(meter.high).toBe(0.5);
    expect(meter.activity).toBe(0);
  });
});

describe('formatting', () => {
  it('writes numbers with the digits worth reading', () => {
    expect(
      [0, 0.0001, 0.00314159, 0.25, 12.5, 12.3456, 440, 123.456, 12000.4, -0.5].map(formatNumber),
    ).toEqual(['0', '0.0001', '0.00314', '0.25', '12.5', '12.35', '440', '123.5', '12000', '-0.5']);
    expect(formatNumber(1e-9)).toBe('1.0e-9');
    expect(formatNumber(Number.NaN)).toBe('NaN');
  });

  it('writes decibels with one decimal, and silence as -inf', () => {
    expect(formatDb(-6.0206)).toBe('-6.0');
    expect(formatDb(SILENCE_DB)).toBe('-inf');
  });
});
