import { describe, expect, it } from 'vitest';
import { createEngine, defineMacro } from '../../src';
import type { Engine } from '../../src';
import { SAMPLE_RATE, constant, offlineEngine, ones, valueAt } from './setup';

/** The largest second difference of a channel: how sharp the sharpest corner in the waveform is. */
function roughness(audio: AudioBuffer, from = 0.05, to = audio.duration - 0.05): number {
  let worst = 0;
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const data = audio.getChannelData(channel);
    const end = Math.round(to * audio.sampleRate);
    for (let i = Math.round(from * audio.sampleRate) + 2; i < end; i++) {
      worst = Math.max(worst, Math.abs(data[i]! - 2 * data[i - 1]! + data[i - 2]!));
    }
  }
  return worst;
}

/** The largest change from one sample to the next between two times. */
function largestStep(audio: AudioBuffer, from: number, to: number): number {
  const data = audio.getChannelData(0);
  let worst = 0;
  const end = Math.min(data.length, Math.round(to * SAMPLE_RATE));
  for (let i = Math.round(from * SAMPLE_RATE) + 1; i < end; i++) {
    worst = Math.max(worst, Math.abs(data[i]! - data[i - 1]!));
  }
  return worst;
}

type Move = (value: number, at: number) => void;

/** A control moved from `low` to `high` and back over 0.8 seconds, `rate` times a second. */
function sweep(rate: number, low: number, high: number, move: Move): void {
  const moves = Math.round(0.8 * rate);
  for (let i = 0; i <= moves; i++) {
    const position = i / moves;
    const up = position <= 0.5 ? position * 2 : 2 - position * 2;
    move(low + (high - low) * up, 0.1 + i / rate);
  }
}

/** A 220 Hz sine through a gain, rendered for a second while `move` sweeps the gain. */
async function levelSwept(rate: number, how: 'steady' | 'set' | 'glide' | 'ramp'): Promise<number> {
  const engine = await offlineEngine(1);
  engine.chain().sine({ frequency: 220 }).gain({ id: 'level', gain: 1 }).to('main');
  const gain = engine.select('#level').param('gain');
  if (how !== 'steady') {
    gain.set(0, { at: 0 });
    sweep(rate, 0, 1, (value, at) => {
      if (how === 'set') gain.set(value, { at });
      else if (how === 'glide') gain.set(value, { at, glide: 0.02 });
      else gain.ramp(value, { at, duration: 0.02 });
    });
  }
  return roughness(await engine.render());
}

/** The same for a panner's pan, in stereo. */
async function panSwept(rate: number, how: 'steady' | 'set' | 'glide'): Promise<number> {
  const engine = await offlineEngine(1, 2);
  engine.chain().sine({ frequency: 220 }).panner({ id: 'pan', pan: -1 }).to('main');
  const pan = engine.select('#pan').param('pan');
  if (how !== 'steady') {
    sweep(rate, -1, 1, (value, at) => {
      if (how === 'set') pan.set(value, { at });
      else pan.set(value, { at, glide: 0.02 });
    });
  }
  return roughness(await engine.render());
}

/** A constant 1 through a gain with the id `level`, so the render is the gain's value over time. */
async function levelOf(seconds: number, gain: number) {
  const engine = await offlineEngine(seconds);
  constant(engine, seconds).gain({ id: 'level', gain }).to('main');
  return { engine, level: engine.select('#level'), param: engine.select('#level').param('gain') };
}

/**
 * How far a glided sweep's sharpest corner may be above a steady tone's. Measured, with a 20 ms
 * glide, as the largest second difference of the output (Chromium; Firefox and WebKit agree to
 * three figures):
 *
 *                      steady tone   set       set with glide
 *   level, 60 moves/s    8.30e-4     3.74e-2   8.22e-4
 *   level, 125 moves/s   8.30e-4     2.08e-2   8.45e-4
 *   pan, 60 moves/s      8.30e-4     5.76e-2   8.30e-4
 *   pan, 125 moves/s     8.30e-4     3.14e-2   8.30e-4
 *
 * So a glide is within 2% of the steady tone, and a stepped sweep is 25 to 70 times it.
 */
const NEAR = 1.05;

describe('set with glide: following a moving control', () => {
  for (const rate of [60, 125]) {
    it(`a level swept ${rate} times a second is as smooth as a steady tone`, async () => {
      const steady = await levelSwept(rate, 'steady');
      const stepped = await levelSwept(rate, 'set');
      const glided = await levelSwept(rate, 'glide');
      const ramped = await levelSwept(rate, 'ramp');
      expect(glided).toBeLessThan(steady * NEAR);
      expect(stepped).toBeGreaterThan(steady * 10);
      // A ramp issued while the last is in flight starts from the value reached, as a glide does.
      expect(ramped).toBeLessThan(steady * NEAR);
    });

    it(`a pan swept ${rate} times a second is as smooth as a steady tone`, async () => {
      const steady = await panSwept(rate, 'steady');
      const stepped = await panSwept(rate, 'set');
      const glided = await panSwept(rate, 'glide');
      expect(glided).toBeLessThan(steady * NEAR);
      expect(stepped).toBeGreaterThan(steady * 10);
    });
  }

  it('glides in a straight line from the value at `at` and arrives exactly', async () => {
    const { engine, param } = await levelOf(0.5, 0.2);
    param.set(1, { at: 0.1, glide: 0.2 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.05)).toBeCloseTo(0.2, 6);
    expect(valueAt(audio, 0.1)).toBeCloseTo(0.2, 6);
    expect(valueAt(audio, 0.2)).toBeCloseTo(0.6, 5);
    expect(valueAt(audio, 0.3)).toBeCloseTo(1, 6);
    expect(valueAt(audio, 0.45)).toBe(1);
  });

  it('retargeted mid-glide, it carries on from the value reached with no jump', async () => {
    const { engine, param } = await levelOf(0.5, 0);
    param.set(1, { at: 0.1, glide: 0.1 });
    param.set(0, { at: 0.15, glide: 0.1 });
    param.set(0.25, { at: 0.2, glide: 0.1 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.125)).toBeCloseTo(0.25, 5);
    expect(valueAt(audio, 0.15)).toBeCloseTo(0.5, 5);
    expect(valueAt(audio, 0.175)).toBeCloseTo(0.375, 5);
    expect(valueAt(audio, 0.2)).toBeCloseTo(0.25, 5);
    expect(valueAt(audio, 0.25)).toBeCloseTo(0.25, 5);
    expect(valueAt(audio, 0.4)).toBeCloseTo(0.25, 6);
    // The steepest glide here covers 1 in 0.1 s: no sample moves further than that slope allows.
    expect(largestStep(audio, 0, 0.5)).toBeLessThan((1 / (0.1 * SAMPLE_RATE)) * 1.01);
  });

  it('retargets the same way where the browser cannot hold a ramp in flight', async () => {
    const proto = AudioParam.prototype as { cancelAndHoldAtTime?: unknown };
    const original = Object.getOwnPropertyDescriptor(proto, 'cancelAndHoldAtTime');
    if (original) delete proto.cancelAndHoldAtTime;
    try {
      const { engine, param } = await levelOf(0.5, 0);
      param.set(1, { at: 0.1, glide: 0.1 });
      param.set(0, { at: 0.15, glide: 0.1 });
      const audio = await engine.render();
      expect(valueAt(audio, 0.15)).toBeCloseTo(0.5, 5);
      expect(valueAt(audio, 0.2)).toBeCloseTo(0.25, 5);
      expect(valueAt(audio, 0.3)).toBeCloseTo(0, 6);
      expect(largestStep(audio, 0, 0.5)).toBeLessThan((1 / (0.1 * SAMPLE_RATE)) * 1.01);
    } finally {
      if (original) Object.defineProperty(proto, 'cancelAndHoldAtTime', original);
    }
  });

  it('takes over from a ramp in flight, linear or exponential', async () => {
    const { engine, param } = await levelOf(0.5, 0);
    param.ramp(1, { at: 0, duration: 0.2 });
    param.set(0.5, { at: 0.1, glide: 0.1 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.1)).toBeCloseTo(0.5, 5);
    expect(valueAt(audio, 0.15)).toBeCloseTo(0.5, 5);
    expect(valueAt(audio, 0.3)).toBeCloseTo(0.5, 6);

    const exp = await levelOf(0.5, 1);
    exp.param.ramp(0.01, { at: 0, duration: 0.2, curve: 'exp' });
    exp.param.set(0.1, { at: 0.1, glide: 0.1 });
    const curved = await exp.engine.render();
    // Half-way through an exponential ramp from 1 to 0.01 the value is 0.1.
    expect(valueAt(curved, 0.1)).toBeCloseTo(0.1, 4);
    expect(valueAt(curved, 0.15)).toBeCloseTo(0.1, 4);
    expect(largestStep(curved, 0.05, 0.5)).toBeLessThan(0.001);
  });

  it('scheduled for later, it leaves the value alone until then', async () => {
    const { engine, param } = await levelOf(0.6, 0.5);
    param.set(1, { at: 0.3, glide: 0.1 });
    // A second one for a later time still, issued before the first has started.
    param.set(0, { at: 0.35, glide: 0.1 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.29)).toBeCloseTo(0.5, 6);
    expect(valueAt(audio, 0.35)).toBeCloseTo(0.75, 5);
    expect(valueAt(audio, 0.4)).toBeCloseTo(0.375, 5);
    expect(valueAt(audio, 0.45)).toBeCloseTo(0, 6);
  });

  it('replaces what was scheduled after it, and starts from a value set at the same time', async () => {
    const { engine, param } = await levelOf(0.5, 0);
    param.set(1, { at: 0.3 });
    param.set(0.8, { at: 0.1 });
    param.set(0.4, { at: 0.1, glide: 0.1 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.1)).toBeCloseTo(0.8, 5);
    expect(valueAt(audio, 0.15)).toBeCloseTo(0.6, 5);
    expect(valueAt(audio, 0.4)).toBeCloseTo(0.4, 6);
    expect(param.value).toBe(0.4);
  });

  it('a set during a glide stops it there: the value stays where it was set', async () => {
    const { engine, param } = await levelOf(0.5, 0);
    param.set(1, { at: 0.1, glide: 0.2 });
    param.set(0.3, { at: 0.2 });
    expect(param.value).toBe(0.3);
    const audio = await engine.render();
    expect(valueAt(audio, 0.19)).toBeCloseTo(0.45, 5);
    expect(valueAt(audio, 0.2)).toBeCloseTo(0.3, 6);
    expect(valueAt(audio, 0.25)).toBeCloseTo(0.3, 6);
    expect(valueAt(audio, 0.4)).toBeCloseTo(0.3, 6);
  });

  it('a set after a glide has arrived is an ordinary step', async () => {
    const { engine, param } = await levelOf(0.5, 0);
    param.set(1, { at: 0.1, glide: 0.1 });
    param.set(0.3, { at: 0.3 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.25)).toBeCloseTo(1, 6);
    expect(valueAt(audio, 0.3)).toBeCloseTo(0.3, 6);
  });

  it('a ramp during a glide starts from the value reached', async () => {
    const { engine, param } = await levelOf(0.6, 0);
    param.set(1, { at: 0.1, glide: 0.2 });
    param.ramp(0, { at: 0.2, duration: 0.2 });
    expect(param.value).toBe(0);
    const audio = await engine.render();
    expect(valueAt(audio, 0.2)).toBeCloseTo(0.5, 5);
    expect(valueAt(audio, 0.3)).toBeCloseTo(0.25, 5);
    expect(valueAt(audio, 0.4)).toBeCloseTo(0, 6);
    expect(valueAt(audio, 0.5)).toBeCloseTo(0, 6);
    expect(largestStep(audio, 0, 0.6)).toBeLessThan((1 / (0.2 * SAMPLE_RATE)) * 1.01);
  });

  it('a ramp after a glide has arrived starts from its target', async () => {
    const { engine, param } = await levelOf(0.6, 0);
    param.set(1, { at: 0.1, glide: 0.1 });
    param.ramp(0, { at: 0.3, duration: 0.2 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.3)).toBeCloseTo(1, 6);
    expect(valueAt(audio, 0.4)).toBeCloseTo(0.5, 5);
  });

  it('reports the target as the value at once, and emits one change for when it arrives', async () => {
    const { param } = await levelOf(0.5, 0.5);
    const seen: { value: unknown; previous: unknown; at: number }[] = [];
    param.on('change', ({ value, previous, at }) => seen.push({ value, previous, at }));
    param.set(0.8, { at: 0.1, glide: 0.05 });
    expect(param.value).toBe(0.8);
    param.set(0.8, { at: 0.2, glide: 0.05 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ value: 0.8, previous: 0.5 });
    expect(seen[0]!.at).toBeCloseTo(0.15, 9);
    param.setNormalized(0, { at: 0.3, glide: 0.05 });
    param.reset({ at: 0.4, glide: 0.05 });
    expect(seen.map((change) => change.value)).toEqual([0.8, 0, param.meta.default]);
  });

  it('a glide of 0 is an ordinary set, and one that cannot be is refused', async () => {
    const { engine, param } = await levelOf(0.3, 0);
    const seen: number[] = [];
    param.on('change', ({ at }) => seen.push(at));
    param.set(1, { at: 0.1, glide: 0 });
    expect(seen).toEqual([0.1]);
    expect(() => param.set(0.5, { glide: -1 })).toThrowError(/needs a glide of 0 or more seconds/);
    expect(() => param.set(0.5, { glide: Number.NaN })).toThrowError(/needs a glide/);
    expect(param.value).toBe(1);
    const audio = await engine.render();
    expect(valueAt(audio, 0.099)).toBeCloseTo(0, 6);
    expect(valueAt(audio, 0.1)).toBeCloseTo(1, 6);
  });

  it('sets at once what cannot glide: control-rate, boolean and choice parameters', async () => {
    const engine = await offlineEngine(0.2);
    engine
      .chain()
      .sampler({ id: 's', buffer: ones(0.2) })
      .lowpass({ id: 'f' })
      .to('main');
    const speed = engine.select('#s').param('speed');
    const seen: number[] = [];
    speed.on('change', ({ at }) => seen.push(at));
    speed.set(2, { at: 0.1, glide: 0.05 });
    expect(speed.value).toBe(2);
    expect(seen).toEqual([0.1]);
    engine.select('#s').param('loop').set(true, { glide: 0.05 });
    expect(engine.select('#s').param('loop').value).toBe(true);
    // One call for a whole selection: the filter's frequency glides, the sampler's speed steps.
    engine.select('*').set({ frequency: 800, speed: 0.5 }, { at: 0.1, glide: 0.05 });
    expect(engine.select('#f').param('frequency').value).toBe(800);
    expect(speed.value).toBe(0.5);
    expect(() => speed.set(1, { glide: -1 })).toThrowError(/needs a glide/);
  });

  it('is an option of selection.set, of the generated setters and of the set command', async () => {
    const engine = await offlineEngine(0.6);
    constant(engine, 0.6).gain({ id: 'level', gain: 0 }).to('main');
    engine.select('#level').set({ gain: 1 }, { at: 0, glide: 0.1 });
    engine.select('#level').gain(0, { at: 0.2, glide: 0.1 });
    engine.root.dispatch([
      { op: 'set', target: '#level', at: 0.4, values: { gain: 1 }, glide: 0.1 },
    ]);
    const audio = await engine.render();
    expect(valueAt(audio, 0.05)).toBeCloseTo(0.5, 5);
    expect(valueAt(audio, 0.15)).toBeCloseTo(1, 6);
    expect(valueAt(audio, 0.25)).toBeCloseTo(0.5, 5);
    expect(valueAt(audio, 0.35)).toBeCloseTo(0, 6);
    expect(valueAt(audio, 0.45)).toBeCloseTo(0.5, 5);
    expect(valueAt(audio, 0.55)).toBeCloseTo(1, 6);
  });

  it("glides a bus's level and the pan of a panner on it", async () => {
    const engine = await offlineEngine(0.5, 2);
    const bus = engine.bus('drums');
    bus.panner({ id: 'pan' });
    constant(engine, 0.5).to('drums');
    bus.gain.set(0.5, { at: 0.1, glide: 0.1 });
    engine.select('#pan').set({ pan: 1 }, { at: 0.3, glide: 0.1 });
    expect(bus.gain.value).toBe(0.5);
    const audio = await engine.render();
    const left = audio.getChannelData(0);
    const right = audio.getChannelData(1);
    const index = (seconds: number) => Math.round(seconds * SAMPLE_RATE);
    // Centre, level gliding from 1 to 0.5.
    expect(left[index(0.05)]).toBeCloseTo(Math.SQRT1_2, 4);
    expect(left[index(0.15)]).toBeCloseTo(0.75 * Math.SQRT1_2, 4);
    expect(left[index(0.25)]).toBeCloseTo(0.5 * Math.SQRT1_2, 4);
    // Then panned right over 0.1 s: half-way there at 0.35, all the way by 0.4.
    expect(right[index(0.35)]).toBeCloseTo(0.5 * Math.sin((3 * Math.PI) / 8), 4);
    expect(left[index(0.45)]).toBeCloseTo(0, 5);
    expect(right[index(0.45)]).toBeCloseTo(0.5, 4);
    let worst = 0;
    for (let i = 1; i < left.length; i++) {
      worst = Math.max(
        worst,
        Math.abs(left[i]! - left[i - 1]!),
        Math.abs(right[i]! - right[i - 1]!),
      );
    }
    expect(worst).toBeLessThan(0.001);
  });

  it("glides the inner parameters a macro's exposed parameter drives", async () => {
    const fader = defineMacro({
      type: 'glidefader',
      category: 'utility',
      description: 'Test macro: a level control.',
      params: {
        amount: { default: 0.5, min: 0, max: 1, drives: [{ select: '#level', param: 'gain' }] },
        half: {
          default: 1,
          min: 0,
          max: 2,
          drives: [{ select: '#trim', param: 'gain', scale: { multiply: 0.5 } }],
        },
      },
      build(__) {
        __.bus('in').chain().gain({ id: 'level' }).gain({ id: 'trim', gain: 0.5 }).to('out');
      },
    });
    const context = new OfflineAudioContext(1, SAMPLE_RATE * 0.6, SAMPLE_RATE);
    const engine: Engine = await createEngine({ context, nodes: [fader] });
    const chain = engine.chain().sampler({ id: 'dc', buffer: ones(0.6) }) as unknown as {
      glidefader(init: object): { to(bus: string): void };
    };
    chain.glidefader({ id: 'f', amount: 0 }).to('main');
    engine.select('#dc').trigger({ at: 0 });
    const f = engine.select('#f');
    const seen: number[] = [];
    f.param('amount').on('change', ({ at }) => seen.push(at));
    f.set({ amount: 1 }, { at: 0.1, glide: 0.1 });
    f.set({ amount: 0.5 }, { at: 0.15, glide: 0.1 });
    f.set({ half: 2 }, { at: 0.4, glide: 0.1 });
    expect(f.param('amount').value).toBe(0.5);
    expect(engine.select('#f #level').param('gain').value).toBe(0.5);
    expect(seen[0]).toBeCloseTo(0.2, 9);
    const audio = await engine.render();
    expect(valueAt(audio, 0.15)).toBeCloseTo(0.25, 5);
    expect(valueAt(audio, 0.3)).toBeCloseTo(0.25, 5);
    expect(valueAt(audio, 0.45)).toBeCloseTo(0.5 * 0.75, 5);
    expect(valueAt(audio, 0.55)).toBeCloseTo(0.5, 5);
  });

  it('leaves offsets as they are', async () => {
    const { engine, level, param } = await levelOf(0.5, 0);
    level.offset('gain', 0.5, { at: 0.1, duration: 0.3 });
    param.set(1, { at: 0.2, glide: 0.1 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.15)).toBeCloseTo(0.5, 6);
    expect(valueAt(audio, 0.25)).toBeCloseTo(1, 5);
    expect(valueAt(audio, 0.35)).toBeCloseTo(1.5, 5);
    expect(valueAt(audio, 0.45)).toBeCloseTo(1, 6);
  });
});

describe('set with glide and build', () => {
  type Api = Parameters<Parameters<Engine['root']['build']>[0]>[0];
  const graph = (api: Api, gain: number): void => {
    api()
      .sampler({ id: 'dc', buffer: ones(0.5) })
      .gain({ id: 'level', gain })
      .to('main');
  };

  it('a glide in the build function has the last word, on every re-run', async () => {
    const engine = await offlineEngine(0.5);
    const scope = engine.scope('live');
    const code = (api: Api): void => {
      graph(api, 0.2);
      api('#level').set({ gain: 0.8 }, { glide: 0.2 });
    };
    await scope.build(code);
    expect(scope.select('#level').param('gain').value).toBe(0.8);
    const again = await scope.build(code);
    expect(again.added).toHaveLength(0);
    expect(again.errors).toHaveLength(0);
    expect(scope.select('#level').param('gain').value).toBe(0.8);
    scope.select('#dc').trigger({ at: 0 });
    const audio = await engine.render();
    expect(valueAt(audio, 0)).toBeCloseTo(0.2, 6);
    expect(valueAt(audio, 0.1)).toBeCloseTo(0.5, 5);
    expect(valueAt(audio, 0.3)).toBeCloseTo(0.8, 6);
  });

  it('a rebuild that asks for another value stops a glide in flight and sets it', async () => {
    const engine = await offlineEngine(0.5);
    const scope = engine.scope('live');
    await scope.build((api) => graph(api, 0.2));
    scope.select('#level').set({ gain: 0.8 }, { glide: 0.2 });
    const result = await scope.build((api) => graph(api, 0.4));
    expect(result.updated.map((node) => node.id)).toContain('level');
    expect(scope.select('#level').param('gain').value).toBe(0.4);
    scope.select('#dc').trigger({ at: 0 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.1)).toBeCloseTo(0.4, 6);
    expect(valueAt(audio, 0.3)).toBeCloseTo(0.4, 6);
  });

  it('a rebuild that asks for the value being glided to leaves the glide alone', async () => {
    const engine = await offlineEngine(0.5);
    const scope = engine.scope('live');
    await scope.build((api) => graph(api, 0.2));
    scope.select('#level').set({ gain: 0.8 }, { at: 0.1, glide: 0.2 });
    const result = await scope.build((api) => graph(api, 0.8));
    expect(result.unchanged.map((node) => node.id)).toContain('level');
    scope.select('#dc').trigger({ at: 0 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.05)).toBeCloseTo(0.2, 6);
    expect(valueAt(audio, 0.2)).toBeCloseTo(0.5, 5);
    expect(valueAt(audio, 0.4)).toBeCloseTo(0.8, 6);
  });

  it('a glide that cannot be fails the build and leaves everything as it was', async () => {
    const engine = await offlineEngine(0.5);
    const scope = engine.scope('live');
    await scope.build((api) => graph(api, 0.2));
    const failed = scope.build((api) => {
      graph(api, 0.6);
      api('#level').set({ gain: 0.9 }, { glide: -1 });
    });
    await expect(failed).rejects.toMatchObject({
      code: 'invalid-param',
      nodeId: 'level',
      message: /needs a glide of 0 or more seconds/,
    });
    expect(scope.select('#level').param('gain').value).toBe(0.2);
  });
});

describe('ramps and sets while a ramp is in flight', () => {
  it('a ramp with no `from` starts from the value an earlier ramp has reached', async () => {
    const { engine, param } = await levelOf(0.6, 0);
    param.ramp(1, { at: 0.1, duration: 0.2 });
    param.ramp(0, { at: 0.2, duration: 0.1 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.2)).toBeCloseTo(0.5, 5);
    expect(valueAt(audio, 0.25)).toBeCloseTo(0.25, 5);
    // The first ramp's end, at 0.3, no longer pulls the value back up.
    expect(valueAt(audio, 0.3)).toBeCloseTo(0, 6);
    expect(valueAt(audio, 0.5)).toBeCloseTo(0, 6);
    expect(param.value).toBe(0);
  });

  it('a ramp given `from` starts there, as before', async () => {
    const { engine, param } = await levelOf(0.6, 0);
    param.ramp(1, { at: 0.1, duration: 0.2 });
    param.ramp(0, { at: 0.2, duration: 0.2, from: 0.8 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.199)).toBeCloseTo(0.495, 4);
    expect(valueAt(audio, 0.2)).toBeCloseTo(0.8, 6);
    expect(valueAt(audio, 0.3)).toBeCloseTo(0.4, 5);
    expect(valueAt(audio, 0.5)).toBeCloseTo(0, 6);
  });

  it('a ramp starts from the value at its time, not from one scheduled for later', async () => {
    const { engine, param } = await levelOf(0.6, 0.2);
    param.set(1, { at: 0.4 });
    param.ramp(0.6, { at: 0.1, duration: 0.2 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.1)).toBeCloseTo(0.2, 6);
    expect(valueAt(audio, 0.2)).toBeCloseTo(0.4, 5);
    expect(valueAt(audio, 0.35)).toBeCloseTo(0.6, 6);
    // What was scheduled for later still happens.
    expect(valueAt(audio, 0.45)).toBeCloseTo(1, 6);
  });

  it('a set during a ramp stays set, and what was scheduled for later still happens', async () => {
    const { engine, param } = await levelOf(0.6, 0);
    param.set(0.9, { at: 0.4 });
    param.ramp(1, { at: 0.1, duration: 0.2 });
    param.set(0.3, { at: 0.2 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.199)).toBeCloseTo(0.495, 4);
    expect(valueAt(audio, 0.25)).toBeCloseTo(0.3, 6);
    expect(valueAt(audio, 0.35)).toBeCloseTo(0.3, 6);
    expect(valueAt(audio, 0.45)).toBeCloseTo(0.9, 6);
  });

  it('cancel still drops a ramp or glide in flight and returns to the value before it', async () => {
    const { engine, param } = await levelOf(0.5, 0.2);
    param.set(1, { at: 0.1, glide: 0.2 });
    param.cancel({ at: 0.2 });
    expect(param.value).toBe(0.2);
    param.set(0.6, { at: 0.3, glide: 0.1 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.25)).toBeCloseTo(0.2, 6);
    expect(valueAt(audio, 0.35)).toBeCloseTo(0.4, 5);
    expect(valueAt(audio, 0.45)).toBeCloseTo(0.6, 6);
  });
});
