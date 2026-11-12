import { describe, expect, it } from 'vitest';
import { compressorMakeup } from '../../src/nodes/basic';
import { gainToDb } from '../../src/util';
import { peak, rms } from '../helpers';
import { SAMPLE_RATE, makeBuffer, offlineEngine } from '../core/setup';
import { drumLoop, goertzel } from './util';

/** Every band left alone: nothing over a threshold, no gain added. */
const OFF = {
  lowThreshold: 0,
  midThreshold: 0,
  highThreshold: 0,
  lowRatio: 1,
  midRatio: 1,
  highRatio: 1,
  lowGain: 0,
  midGain: 0,
  highGain: 0,
};

type Init = Record<string, number>;

const sine = (hz: number, seconds: number, amplitude = 0.25) =>
  makeBuffer(seconds, (_i, t) => amplitude * Math.sin(2 * Math.PI * hz * t));

/** Renders a buffer through a multiband and returns the samples. */
async function through(buffer: AudioBuffer, init: Init, at = 0, seconds = buffer.duration + at) {
  const engine = await offlineEngine(seconds);
  engine
    .chain()
    .sampler({ id: 'in', buffer })
    .multiband({ id: 'mb', ...init })
    .to('main');
  engine.select('#in').trigger({ at });
  return engine.render();
}

/** Level of a steady sine after the multiband, in dB relative to what went in. */
async function levelOf(hz: number, init: Init, amplitude = 0.25): Promise<number> {
  const audio = await through(sine(hz, 1, amplitude), init);
  // The second half, when filters and compressors have settled.
  return gainToDb(goertzel(audio.getChannelData(0).subarray(24000, 48000), hz) / amplitude);
}

const energy = (data: Float32Array) => data.reduce((sum, v) => sum + v * v, 0);

describe('multiband', () => {
  // Across the bands and on both crossovers (200 Hz and 2500 Hz by default).
  const FREQUENCIES = [30, 60, 100, 150, 200, 280, 500, 1000, 1800, 2500, 3500, 6000, 12000, 18000];

  it('with compression off passes every frequency at the level it came in', async () => {
    const levels: number[] = [];
    for (const hz of FREQUENCIES) levels.push(await levelOf(hz, OFF));
    // Measured: within 0.0002 dB everywhere in Chromium and WebKit; Firefox is 0.013 dB down at 18 kHz.
    for (const level of levels) expect(Math.abs(level)).toBeLessThan(0.05);
  });

  it('still adds up flat after both crossovers are moved', async () => {
    const levels: number[] = [];
    const moved = { ...OFF, lowCrossover: 500, highCrossover: 5000 };
    for (const hz of [100, 350, 500, 700, 2000, 3500, 5000, 7000, 12000, 18000]) {
      levels.push(await levelOf(hz, moved));
    }
    for (const level of levels) expect(Math.abs(level)).toBeLessThan(0.05);
  });

  it('with compression off keeps the energy of a click', async () => {
    // A compressor that has only just been made lets sound in gradually for its first 20 ms or so (in
    // every browser), so the click comes a little later than that.
    const audio = await through(
      makeBuffer(0.01, (i) => (i === 0 ? 1 : 0)),
      OFF,
      0.2,
      0.6,
    );
    const data = audio.getChannelData(0);
    // Measured: 0.99997 in Chromium and WebKit, 0.9891 in Firefox.
    expect(energy(data)).toBeGreaterThan(0.97);
    expect(energy(data)).toBeLessThan(1.01);
    // Nothing comes out before the click does, 6 ms (288 samples) after it went in.
    expect(rms(audio, 0, 0, 9600 + 280)).toBeLessThan(1e-6);
    expect(rms(audio, 0, 9600 + 280, 9600 + 400)).toBeGreaterThan(0.01);
  });

  it('compresses each band without touching the others', async () => {
    // A loud low tone, a middle tone and a quieter high tone, all at once.
    const tones = [
      [60, 0.5],
      [700, 0.25],
      [6000, 0.1],
    ] as const;
    const chord = makeBuffer(1, (_i, t) =>
      tones.reduce((sum, [hz, amplitude]) => sum + amplitude * Math.sin(2 * Math.PI * hz * t), 0),
    );
    const levels = async (init: Init) => {
      const data = (await through(chord, init)).getChannelData(0).subarray(24000, 48000);
      return tones.map(([hz, amplitude]) => gainToDb(goertzel(data, hz) / amplitude));
    };

    const untouched = await levels(OFF);
    for (const level of untouched) expect(Math.abs(level)).toBeLessThan(0.05);

    // Measured, dB for [60 Hz, 700 Hz, 6 kHz]:
    //   low squashed   -25.63  -0.06   0.00
    //   mid squashed    -0.07 -21.23  -0.20   (Firefox -21.82 in the middle)
    //   high squashed    0.00  -0.04 -14.25   (Firefox -20.88: its compressor is harder on high sounds)
    for (const [index, band] of (['low', 'mid', 'high'] as const).entries()) {
      const squashed = await levels({ ...OFF, [`${band}Threshold`]: -40, [`${band}Ratio`]: 10 });
      squashed.forEach((level, tone) => {
        if (tone === index) expect(level, `${band}: its own tone`).toBeLessThan(-12);
        else expect(Math.abs(level), `${band}: tone ${tone}`).toBeLessThan(0.4);
      });
    }
  });

  it('leaves sound below the thresholds at its own level', async () => {
    // At the default thresholds, with no gain added: a tone at -40 dB is under all of them.
    const quiet = { lowGain: 0, midGain: 0, highGain: 0 };
    const levels = [await levelOf(60, quiet, 0.01), await levelOf(1000, quiet, 0.01)];
    // Measured: within 0.0004 dB.
    for (const level of levels) expect(Math.abs(level)).toBeLessThan(0.05);
  });

  it('moving a crossover moves a tone from one band to the other', async () => {
    // Only the low band compresses. 400 Hz is in the middle band until the crossover passes it.
    const engine = await offlineEngine(2);
    engine
      .chain()
      .sampler({ id: 'in', buffer: sine(400, 2, 0.5) })
      .multiband({ id: 'mb', ...OFF, lowThreshold: -40, lowRatio: 10 })
      .to('main');
    engine.select('#in').trigger({ at: 0 });
    engine.select('#mb').set({ lowCrossover: 800 }, { at: 1 });
    const data = (await engine.render()).getChannelData(0);
    const before = gainToDb(goertzel(data.subarray(24000, 48000), 400) / 0.5);
    const after = gainToDb(goertzel(data.subarray(72000, 96000), 400) / 0.5);
    // Measured: -0.26 dB before, -20.07 dB after (Firefox -0.27 and -20.15).
    expect(before).toBeGreaterThan(-1);
    expect(after).toBeLessThan(-15);
    // Every filter on that crossover moved: the low band's two, the upper bands' two, the original's allpass.
    const moved = engine.select('#mb .lowCrossover');
    expect(moved.length).toBe(5);
    for (const node of moved) expect(node.param('frequency').value).toBe(800);
    expect(engine.select('#mb .highCrossover').length).toBe(6);
  });

  it('each band has its own level control, in decibels', async () => {
    const mid = await levelOf(1000, { ...OFF, midGain: 6 });
    const low = await levelOf(60, { ...OFF, midGain: 6, lowGain: -6 });
    const high = await levelOf(10000, { ...OFF, highGain: -12 });
    // Not exactly 6 and -6: a little of each tone is in the neighbouring band. Measured 5.89, -5.80, -11.94.
    expect(mid).toBeCloseTo(5.89, 1);
    expect(low).toBeCloseTo(-5.8, 1);
    expect(high).toBeCloseTo(-11.94, 1);
  });

  it('mix blends in the original without thinning it', async () => {
    // With compression off the two paths are the same signal, so any blend of them is flat too. If
    // the original were not lined up with the bands, this would dip wherever the two cancelled.
    const levels: number[] = [];
    for (const hz of FREQUENCIES) levels.push(await levelOf(hz, { ...OFF, mix: 0.5 }));
    for (const level of levels) expect(Math.abs(level)).toBeLessThan(0.05);

    // With the low band squashed 25.6 dB, half and half comes out as the mean of the two: -5.58 dB.
    const squash = { ...OFF, lowThreshold: -40, lowRatio: 10 };
    const half = await levelOf(60, { ...squash, mix: 0.5 }, 0.5);
    const dry = await levelOf(60, { ...squash, mix: 0 }, 0.5);
    expect(half).toBeCloseTo(gainToDb((1 + 10 ** (-25.63 / 20)) / 2), 1);
    expect(Math.abs(dry)).toBeLessThan(0.05);
  });

  it('at its default settings leaves drums about as loud as they were', async () => {
    const kit = drumLoop(4);
    const audio = await through(kit, {});
    const peakDb = gainToDb(peak(audio) / peak(kit));
    const rmsDb = gainToDb(rms(audio) / rms(kit));
    // The input peaks at 0.954 with an RMS of 0.123. Measured out: peak 0.922 (-0.29 dB) and RMS
    // 0.100 (-1.75 dB) in Chromium and WebKit; peak 0.763 (-1.94 dB) and RMS 0.095 (-2.25 dB) in Firefox.
    expect(peakDb).toBeLessThan(0.5);
    expect(peakDb).toBeGreaterThan(-3.5);
    expect(rmsDb).toBeLessThan(0);
    expect(rmsDb).toBeGreaterThan(-3.5);
  });
});

describe('compressor', () => {
  it('lets the first sound after a silence through at full level', async () => {
    // Firefox stops running a compressor whose input is silent, and one that has not been running
    // fades in: without the node's keep-awake signal the first millisecond here measures 0.2.
    const engine = await offlineEngine(1.1);
    engine
      .chain()
      .sampler({ id: 'in', buffer: sine(2000, 0.05) })
      .compressor({ threshold: 0, ratio: 1, knee: 0 })
      .to('main');
    engine.select('#in').trigger({ at: 1 });
    const data = (await engine.render()).getChannelData(0);
    // The compressor's own delay is 288 samples.
    const first = data.subarray(SAMPLE_RATE + 288, SAMPLE_RATE + 288 + 48);
    const level = first.reduce((max, v) => Math.max(max, Math.abs(v)), 0) / 0.25;
    expect(level).toBeGreaterThan(0.99);
    expect(level).toBeLessThan(1.001);
  });

  it('with makeup off leaves sound below the threshold at its own level', async () => {
    const worst = { on: 0, off: 0 };
    for (const [threshold, ratio, knee] of [
      [-60, 12, 30],
      [-40, 4, 0],
      [-24, 4, 6],
      [-24, 20, 40],
      [-12, 1.5, 6],
      [-3, 20, 30],
    ] as const) {
      for (const makeup of [true, false]) {
        const engine = await offlineEngine(0.5);
        engine
          .chain()
          .sampler({ id: 'in', buffer: sine(500, 0.5, 0.0002) })
          .compressor({ threshold, ratio, knee, makeup })
          .to('main');
        engine.select('#in').trigger({ at: 0 });
        const data = (await engine.render()).getChannelData(0).subarray(12000, 24000);
        const level = gainToDb(goertzel(data, 500) / 0.0002);
        if (makeup) {
          // What the browser adds is what the library works out that it adds.
          expect(level).toBeCloseTo(gainToDb(compressorMakeup(threshold, knee, ratio)), 1);
          worst.on = Math.max(worst.on, level);
        } else {
          worst.off = Math.max(worst.off, Math.abs(level));
        }
      }
    }
    // Measured: the browser adds up to 23.06 dB at these settings; with makeup off, 0.004 dB at most is left.
    expect(worst.on).toBeGreaterThan(20);
    expect(worst.off).toBeLessThan(0.03);
  });

  it('with makeup off follows a change of threshold at the time asked', async () => {
    const engine = await offlineEngine(2);
    engine
      .chain()
      .sampler({ id: 'in', buffer: sine(500, 2, 0.5) })
      .compressor({ id: 'c', threshold: 0, ratio: 10, knee: 0, makeup: false })
      .to('main');
    engine.select('#in').trigger({ at: 0 });
    engine.select('#c').set({ threshold: -40 }, { at: 1 });
    const data = (await engine.render()).getChannelData(0);
    const before = gainToDb(goertzel(data.subarray(24000, 48000), 500) / 0.5);
    const after = gainToDb(goertzel(data.subarray(72000, 96000), 500) / 0.5);
    // 34 dB over the threshold at 10:1 comes out 3.4 dB over it: 30.6 dB down. Measured -30.2 (Firefox -30.4).
    expect(Math.abs(before)).toBeLessThan(0.05);
    expect(after).toBeLessThan(-25);
    expect(after).toBeGreaterThan(-34);
  });
});
