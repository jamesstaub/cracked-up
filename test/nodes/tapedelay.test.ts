import { describe, expect, it } from 'vitest';
import type { Engine } from '../../src';
import { rms } from '../helpers';
import { SAMPLE_RATE, click, makeBuffer, offlineEngine } from '../core/setup';
import { drumLoop, goertzel, samples } from './util';

const T = 12000; // 0.25 s at 48 kHz

/** No pitch movement, so timing and levels can be read exactly. */
const STILL = { wow: 0, flutter: 0 };
/** Nothing filtered out of the repeats and as little saturation as there is. */
const OPEN = { ...STILL, tone: 20000, lowCut: 20, drive: 0 };

type Init = Record<string, number>;

const sine = (hz: number, seconds: number, amplitude = 0.1) =>
  makeBuffer(seconds, (_i, t) => amplitude * Math.sin(2 * Math.PI * hz * t));

/** 50 ms of an 800 Hz tone that swells and dies away: narrow enough to pass the loop's filters whole. */
const burst = (amplitude: number) =>
  makeBuffer(0.1, (i) =>
    i < 2400
      ? amplitude * Math.sin((Math.PI * i) / 2400) * Math.sin((2 * Math.PI * 800 * i) / SAMPLE_RATE)
      : 0,
  );

async function setup(seconds: number, buffer: AudioBuffer, init: Init) {
  const engine = await offlineEngine(seconds);
  engine
    .chain()
    .sampler({ id: 'in', buffer })
    .tapedelay({ id: 'tape', ...init })
    .to('main');
  engine.select('#in').trigger({ at: 0 });
  return { engine, tape: engine.select('#tape') };
}

const render = async (engine: Engine) => samples(await engine.render());

async function through(seconds: number, buffer: AudioBuffer, init: Init) {
  return render((await setup(seconds, buffer, init)).engine);
}

/** The largest sample in a range, and where it is. */
function peakIn(data: Float32Array, from: number, to: number) {
  let value = 0;
  let at = from;
  for (let i = Math.max(0, from); i < Math.min(to, data.length); i++) {
    if (Math.abs(data[i]!) > value) {
      value = Math.abs(data[i]!);
      at = i;
    }
  }
  return { value, at };
}

/** Where the energy of a stretch of sound sits, in Hz: lower is darker. From 48 bands, 50 Hz to 16 kHz. */
function centroid(data: Float32Array): number {
  let weighted = 0;
  let total = 0;
  for (let band = 0; band < 48; band++) {
    const hz = 50 * (16000 / 50) ** (band / 47);
    const power = goertzel(data, hz) ** 2;
    weighted += power * hz;
    total += power;
  }
  return weighted / total;
}

/** How far a tone strays from `hz`, in cents, measured over 20 cycles at a time. */
function pitchRange(data: Float32Array, hz: number, from: number, to: number) {
  const crossings: number[] = [];
  for (let i = from + 1; i < to; i++) {
    const a = data[i - 1]!;
    const b = data[i]!;
    if (a < 0 && b >= 0) crossings.push(i - 1 + -a / (b - a));
  }
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i + 20 < crossings.length; i += 20) {
    const found = (20 * SAMPLE_RATE) / (crossings[i + 20]! - crossings[i]!);
    const cents = 1200 * Math.log2(found / hz);
    min = Math.min(min, cents);
    max = Math.max(max, cents);
  }
  return { min, max };
}

/** The largest change from one sample to the next: a click shows up as a jump. */
function largestStep(data: Float32Array, from: number, to: number): number {
  let step = 0;
  for (let i = from + 1; i < to; i++) step = Math.max(step, Math.abs(data[i]! - data[i - 1]!));
  return step;
}

describe('tapedelay', () => {
  it('repeats a click every `time`', async () => {
    const data = await through(1.5, click(), { ...OPEN, time: 0.25, feedback: 0.5, mix: 1 });
    // Nothing until the first repeat.
    expect(peakIn(data, 0, T - 2).value).toBe(0);
    const late = [1, 2, 3, 4, 5].map((k) => peakIn(data, k * T - 100, k * T + 1000).at - k * T);
    // The first repeat is exact. After that Chromium and WebKit add one 128-sample block per trip
    // round a feedback loop and Firefox adds none; the loop's filters can move a peak by a sample.
    // Measured: 0 129 257 385 513 in Chromium and WebKit, 0 1 1 1 1 in Firefox.
    expect(late[0]).toBe(0);
    late.forEach((samplesLate, index) => {
      const trips = index;
      expect(
        Math.min(Math.abs(samplesLate), Math.abs(samplesLate - 128 * trips)),
      ).toBeLessThanOrEqual(2);
    });
  });

  it('each repeat is the feedback fraction of the one before', async () => {
    const data = await through(1.5, burst(0.2), {
      ...STILL,
      drive: 0,
      time: 0.25,
      feedback: 0.5,
      mix: 1,
    });
    const peaks = [1, 2, 3, 4].map((k) => peakIn(data, k * T - 500, k * T + 4000).value / 0.2);
    // The tape takes a little off the first repeat even at the lowest drive (0.2 / (1 + 0.25 x 0.2)).
    // Measured: 0.9525 0.4665 0.2320 0.1155, the same in all three browsers.
    expect(peaks[0]).toBeCloseTo(0.9525, 2);
    expect(peaks[1]! / peaks[0]!).toBeCloseTo(0.5, 1);
    expect(peaks[2]! / peaks[1]!).toBeCloseTo(0.5, 1);
    expect(peaks[3]! / peaks[2]!).toBeCloseTo(0.5, 1);
  });

  it('each repeat is darker than the one before', async () => {
    const data = await through(1.6, click(), { ...STILL, time: 0.25, feedback: 0.5, mix: 1 });
    const repeats = [1, 2, 3, 4, 5].map((k) => data.subarray(k * T - 960, k * T + 9600));
    const centroids = repeats.map(centroid);
    // The share of each repeat's energy that is above 2 kHz.
    const bright = repeats.map((repeat) => {
      const above = [2000, 2800, 4000, 5600, 8000].reduce(
        (sum, hz) => sum + goertzel(repeat, hz) ** 2,
        0,
      );
      const below = [125, 180, 250, 350, 500, 700, 1000, 1400].reduce(
        (sum, hz) => sum + goertzel(repeat, hz) ** 2,
        0,
      );
      return above / (above + below);
    });
    // Measured, the same in all three browsers. Centroids, Hz: 1092 950 896 866 846. Share above
    // 2 kHz: 0.227 0.178 0.151 0.132 0.117.
    for (let k = 1; k < 5; k++) {
      expect(centroids[k]!).toBeLessThan(centroids[k - 1]!);
      expect(bright[k]!).toBeLessThan(bright[k - 1]!);
    }
    expect(centroids[0]).toBeCloseTo(1092, -2);
    expect(centroids[4]).toBeLessThan(centroids[0]! * 0.85);
  });

  it('a lower tone makes darker repeats, and a higher lowCut thinner ones', async () => {
    const init = { ...STILL, time: 0.25, feedback: 0, mix: 1 };
    const repeat = async (extra: Init) =>
      (await through(0.6, click(), { ...init, ...extra })).subarray(T - 960, T + 9600);
    const plain = centroid(await repeat({}));
    const dark = centroid(await repeat({ tone: 800 }));
    const thin = centroid(await repeat({ lowCut: 1000 }));
    // Measured centroids: 1092 Hz as it comes, 399 Hz with tone at 800, 2163 Hz with lowCut at 1000.
    expect(dark).toBeLessThan(plain * 0.7);
    expect(thin).toBeGreaterThan(plain * 1.3);
  });

  it('bends the pitch with wow and flutter, and not at all without them', async () => {
    const range = async (init: Init) => {
      const data = await through(4, sine(1000, 4), {
        time: 0.1,
        feedback: 0,
        mix: 1,
        tone: 20000,
        drive: 0,
        ...init,
      });
      const { min, max } = pitchRange(data, 1000, 24000, data.length);
      return Math.max(Math.abs(min), Math.abs(max));
    };
    const still = await range(STILL);
    const wow = await range({ wow: 1, flutter: 0 });
    const flutter = await range({ wow: 0, flutter: 1 });
    const both = await range({ wow: 1, flutter: 1 });
    const usual = await range({});
    // Measured, cents each way: still 0.00002 at most, wow 26.3, flutter 21.3, both 47.6 to 47.9,
    // the defaults 10.6 to 10.7.
    expect(still).toBeLessThan(0.1);
    expect(wow).toBeGreaterThan(22);
    expect(wow).toBeLessThan(30);
    expect(flutter).toBeGreaterThan(17);
    expect(flutter).toBeLessThan(25);
    expect(both).toBeGreaterThan(40);
    expect(usual).toBeGreaterThan(7);
    expect(usual).toBeLessThan(14);
  });

  it('wow is slow and flutter is fast', async () => {
    // Count how often the pitch crosses from flat to sharp in three seconds.
    const cycles = async (init: Init) => {
      const data = await through(4, sine(1000, 4), {
        time: 0.1,
        feedback: 0,
        mix: 1,
        tone: 20000,
        drive: 0,
        ...init,
      });
      let count = 0;
      let last = 0;
      const crossings: number[] = [];
      for (let i = 48001; i < data.length; i++) {
        if (data[i - 1]! < 0 && data[i]! >= 0)
          crossings.push(i - 1 + -data[i - 1]! / (data[i]! - data[i - 1]!));
      }
      for (let i = 4; i < crossings.length; i += 4) {
        const sharp = (4 * SAMPLE_RATE) / (crossings[i]! - crossings[i - 4]!) - 1000;
        if (last < 0 && sharp >= 0) count++;
        if (sharp !== 0) last = sharp;
      }
      return count / 3;
    };
    const wow = await cycles({ wow: 1, flutter: 0 });
    const flutter = await cycles({ wow: 0, flutter: 1 });
    // Measured: 0.67 and 6.67 a second (the waves run at 0.6 Hz and 6.7 Hz; three seconds hold 2 and 20).
    expect(wow).toBeGreaterThan(0.3);
    expect(wow).toBeLessThan(1);
    expect(flutter).toBeGreaterThan(5);
    expect(flutter).toBeLessThan(8);
  });

  it('with feedback at its highest the repeats build up, stay bounded and never stop', async () => {
    // Measured, as the highest peak anywhere and the RMS of the last four seconds (the ranges span the
    // three browsers):
    //   default        0.46          0.106 to 0.108
    //   least drive    0.61 to 0.63  0.240 to 0.244
    //   most drive     0.23          0.015 to 0.016
    //   shortest time  0.52 to 0.56  0.122 to 0.129
    //   unfiltered     0.82 to 1.00  0.274 to 0.280
    // By then the level rises by at most 8% from one four seconds to the next.
    for (const [name, init, ceiling] of [
      ['default', {}, 0.6],
      ['least drive', { drive: 0 }, 1.0],
      ['most drive', { drive: 1 }, 0.4],
      ['shortest time', { time: 0.02 }, 0.8],
      ['unfiltered', { drive: 0, tone: 20000, lowCut: 20 }, 1.5],
    ] as const) {
      // Two seconds of drums in, then 28 seconds of whatever the loop does with them.
      const data = await through(30, drumLoop(2), { mix: 1, feedback: 1.1, ...init });
      expect(data.every(Number.isFinite), name).toBe(true);
      const peak = peakIn(data, 0, data.length).value;
      const late = data.subarray(26 * SAMPLE_RATE);
      const before = data.subarray(22 * SAMPLE_RATE, 26 * SAMPLE_RATE);
      const level = (part: Float32Array) =>
        Math.sqrt(part.reduce((sum, v) => sum + v * v, 0) / part.length);
      expect(peak, name).toBeLessThan(ceiling);
      // Still sounding half a minute on, and no longer growing by much.
      expect(level(late), name).toBeGreaterThan(0.005);
      expect(level(late) / level(before), name).toBeLessThan(1.3);
    }
  });

  it('with feedback below 1 the repeats die away', async () => {
    const data = await through(12, drumLoop(1), { mix: 1, feedback: 0.6 });
    const level = (from: number, to: number) =>
      peakIn(data, from * SAMPLE_RATE, to * SAMPLE_RATE).value;
    // Measured peaks: 0.125 in the second second, 0.00009 in the sixth, 0.0000009 at the end.
    expect(level(1, 2)).toBeGreaterThan(0.05);
    expect(level(10, 12)).toBeLessThan(1e-4);
  });

  it('with mix 0 outputs the input unchanged', async () => {
    const kit = drumLoop(1);
    const data = await through(1, kit, { mix: 0 });
    expect(data).toEqual(kit.getChannelData(0));
  });

  it('with mix 0.5 passes half the original and half the repeats', async () => {
    const data = await through(0.6, click(), { ...OPEN, time: 0.25, feedback: 0, mix: 0.5 });
    const all = await through(0.6, click(), { ...OPEN, time: 0.25, feedback: 0, mix: 1 });
    expect(data[0]).toBe(0.5);
    expect(data[T]).toBeCloseTo(all[T]! / 2, 6);
    expect(all[0]).toBe(0);
  });

  it('a change of time glides: no click, a swoop of pitch, then the new time', async () => {
    const { engine, tape } = await setup(2.5, sine(500, 2.5), {
      ...OPEN,
      time: 0.1,
      feedback: 0,
      mix: 1,
    });
    engine.chain().sampler({ id: 'tick', buffer: click() }).connect('#tape');
    engine.select('#tick').trigger({ at: 2 });
    tape.set({ time: 0.2 }, { at: 1 });
    const data = await render(engine);
    // A 500 Hz sine of amplitude 0.1 moves at most 0.00654 per sample. A jump of the delay time would
    // show as a far larger step.
    const step = largestStep(data, 24000, 95000);
    const before = pitchRange(data, 500, 24000, 48000);
    const during = pitchRange(data, 500, 48000, 62400);
    const after = pitchRange(data, 500, 76800, 95000);
    const tick = peakIn(data, 96000, data.length);
    // Measured: 0.00663 in Chromium, 0.00654 in WebKit, 0.00653 in Firefox.
    expect(step).toBeLessThan(0.0068);
    expect(Math.max(Math.abs(before.min), Math.abs(before.max))).toBeLessThan(0.1);
    // The delay is growing, so the pitch drops while it does. Measured: as far as 1900 cents.
    expect(during.min).toBeLessThan(-600);
    expect(during.max).toBeLessThan(0);
    expect(Math.max(Math.abs(after.min), Math.abs(after.max))).toBeLessThan(2);
    // A click sent in at 2 s comes out 0.2 s later.
    expect(Math.abs(tick.at - 96000 - 9600)).toBeLessThanOrEqual(2);
  });

  it('time can be ramped, and reports what it was set to', async () => {
    const { engine, tape } = await setup(1, sine(500, 1), {
      ...OPEN,
      time: 0.1,
      feedback: 0,
      mix: 1,
    });
    tape.param('time').ramp(0.3, { at: 0.2, duration: 0.5 });
    expect(tape.param('time').value).toBe(0.3);
    const data = await render(engine);
    expect(largestStep(data, 6000, 48000)).toBeLessThan(0.0068);
  });

  it('accepts the time as a shorthand, and a time from the transport', async () => {
    const engine = await offlineEngine(0.1);
    engine.transport.bpm = 120;
    engine.chain().tapedelay(0.5).to('main');
    engine.chain().tapedelay({ id: 'synced', time: engine.transport.seconds('1/8d') });
    expect(engine.root.describe().nodes[0]?.params).toMatchObject({
      time: 0.5,
      feedback: 0.45,
      mix: 0.5,
    });
    expect(engine.select('#synced').param('time').value).toBeCloseTo(0.375, 10);
  });

  it('at its default settings is no louder than what went in', async () => {
    const kit = drumLoop(4);
    const data = await through(4, kit, {});
    const peak = peakIn(data, 0, data.length).value;
    const level = Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
    // In: peak 0.954, RMS 0.123. Out, with the default mix of half and half: peak 0.478 (-6.0 dB),
    // RMS 0.067 (-5.2 dB), in all three browsers.
    expect(peak).toBeLessThan(0.6);
    expect(peak).toBeGreaterThan(0.4);
    expect(level).toBeLessThan(rms(kit));
    expect(level).toBeGreaterThan(rms(kit) / 2.5);
  });

  describe('freeze', () => {
    /** Peak of each quarter second of the output: one figure per repeat. */
    const repeats = (data: Float32Array) =>
      Array.from({ length: 16 }, (_unused, k) => peakIn(data, k * T, (k + 1) * T).value);

    async function frozen(calls: (tape: Awaited<ReturnType<typeof setup>>['tape']) => void) {
      const { engine, tape } = await setup(4, burst(0.5), {
        ...STILL,
        time: 0.25,
        feedback: 0.6,
        mix: 1,
      });
      const errors: string[] = [];
      engine.on('error', (error) => errors.push(error.message));
      // A second burst later on, to see what happens to new sound.
      engine.select('#in').trigger({ at: 2.1 });
      calls(tape);
      const data = await render(engine);
      expect(errors).toEqual([]);
      return data;
    }

    it('without it the repeats fade', async () => {
      const levels = repeats(await frozen(() => {}));
      // Measured: 0 0.391 0.212 0.122 0.072 0.043 0.025 0.015 0.009, then the second burst the same.
      expect(levels[1]).toBeCloseTo(0.391, 2);
      expect(levels[3]).toBeCloseTo(0.122, 2);
      expect(levels[7]).toBeCloseTo(0.015, 2);
      expect(levels[9]).toBeCloseTo(0.391, 2);
    });

    it('holds the repeat going round at that moment, at the same level, for as long as it is on', async () => {
      const data = await frozen((tape) => tape.call('freeze', {}, { at: 0.6 }));
      const levels = repeats(data);
      // The repeat caught between 0.6 s and 0.85 s is the third, at 0.122. It then stays.
      for (let k = 3; k < 16; k++) expect(levels[k]).toBeCloseTo(0.122, 3);
      // What plays is the captured repeat itself, sample for sample, once per `time`.
      const first = data.subarray(
        Math.round(0.85 * SAMPLE_RATE) + 600,
        Math.round(1.1 * SAMPLE_RATE),
      );
      const later = data.subarray(
        Math.round(3.35 * SAMPLE_RATE) + 600,
        Math.round(3.6 * SAMPLE_RATE),
      );
      expect(later).toEqual(first);
      // No click where the loop takes over or where it comes round: nothing steeper than the sound itself.
      expect(largestStep(data, T * 3, data.length)).toBeLessThanOrEqual(
        largestStep(data, 0, T * 3),
      );
    });

    it('unfreeze lets go of the loop and brings back the live repeats', async () => {
      const levels = repeats(
        await frozen((tape) => {
          tape.call('freeze', {}, { at: 0.6 });
          tape.call('unfreeze', {}, { at: 1.6 });
        }),
      );
      expect(levels[5]).toBeCloseTo(0.122, 3);
      // The tape kept running underneath, so what returns is where the fade had got to.
      expect(levels[7]).toBeCloseTo(0.015, 2);
      expect(levels[9]).toBeCloseTo(0.391, 2);
      expect(levels[11]).toBeCloseTo(0.122, 2);
    });

    it('unfreeze before the loop is full changes nothing that is heard', async () => {
      const plain = await frozen(() => {});
      const early = await frozen((tape) => {
        tape.call('freeze', {}, { at: 0.6 });
        tape.call('unfreeze', {}, { at: 0.7 });
      });
      expect(early).toEqual(plain);
    });

    it('can freeze again, and catches what is going round then', async () => {
      const levels = repeats(
        await frozen((tape) => {
          tape.call('freeze', {}, { at: 0.6 });
          tape.call('freeze', {}, { at: 0.9 }); // already frozen: ignored
          tape.call('unfreeze', {}, { at: 1.6 });
          tape.call('freeze', {}, { at: 2.6 });
        }),
      );
      // The second freeze catches the second burst's second repeat, at 0.212.
      for (let k = 11; k < 16; k++) expect(levels[k]).toBeCloseTo(0.212, 3);
    });
  });
});
