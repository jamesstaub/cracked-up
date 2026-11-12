import { afterEach, describe, expect, it } from 'vitest';
import { SAMPLE_RATE, constant, offlineEngine } from '../core/setup';
import { maxDiff, samples } from './util';

const at = (seconds: number) => Math.round(seconds * SAMPLE_RATE);

interface Run {
  init?: Record<string, number>;
  steps: (env: ReturnType<Awaited<ReturnType<typeof offlineEngine>>['select']>) => void;
}

/** A constant 1 through an adsr, rendered for 3 s. */
async function render({ init = {}, steps }: Run): Promise<Float32Array> {
  const engine = await offlineEngine(3);
  constant(engine, 3)
    .adsr({ id: 'env', ...init })
    .to('main');
  steps(engine.select('#env'));
  return samples(await engine.render());
}

const SHAPE = { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 };

// Linear ramps rendered in float32: every level below was measured to within 1e-6 of the ideal value;
// this leaves 10x of room and still fails on a one-sample timing error (a step of about 2e-4).
const EPS = 1e-5;

describe('adsr', () => {
  it('is silent until triggered, and exactly silent', async () => {
    const data = await render({ init: SHAPE, steps: (env) => env.trigger({ at: 0.5 }) });
    expect(data.subarray(0, at(0.5)).every((v) => v === 0)).toBe(true);
    // WebKit renders the first sample of the ramp as -1.7e-16 rather than 0.
    expect(Math.abs(data[at(0.5)]!)).toBeLessThan(1e-6);
    expect(data[at(0.5) + 1]).toBeGreaterThan(0);
  });

  it('with no trigger at all outputs nothing', async () => {
    const data = await render({ init: SHAPE, steps: () => {} });
    expect(data.every((v) => v === 0)).toBe(true);
  });

  it('rises to 1, falls to the sustain level, and holds it', async () => {
    const data = await render({ init: SHAPE, steps: (env) => env.trigger({ at: 0.5 }) });
    expect(data[at(0.5 + 0.05)]).toBeCloseTo(0.5, 3); // half way up the attack
    expect(Math.abs(data[at(0.6)]! - 1)).toBeLessThan(EPS); // end of attack
    expect(Math.abs(data[at(0.7)]! - 0.75)).toBeLessThan(EPS); // half way down the decay
    expect(Math.abs(data[at(0.8)]! - 0.5)).toBeLessThan(EPS); // end of decay
    expect(Math.abs(data[at(1.5)]! - 0.5)).toBeLessThan(EPS); // still held
    expect(Math.abs(data[at(2.9)]! - 0.5)).toBeLessThan(EPS);
  });

  it('fades to exactly 0 over `release` after release()', async () => {
    const data = await render({
      init: SHAPE,
      steps: (env) => env.trigger({ at: 0.5 }).release({ at: 1.5 }),
    });
    expect(Math.abs(data[at(1.5)]! - 0.5)).toBeLessThan(EPS);
    expect(Math.abs(data[at(1.65)]! - 0.25)).toBeLessThan(EPS);
    expect(Math.abs(data[at(1.8)]!)).toBeLessThan(EPS);
    expect(data.subarray(at(1.8) + 1).every((v) => v === 0)).toBe(true);
  });

  it('releases by itself after `duration`', async () => {
    const data = await render({
      init: SHAPE,
      steps: (env) => env.trigger({ at: 0.5, duration: 1 }),
    });
    expect(Math.abs(data[at(1.4)]! - 0.5)).toBeLessThan(EPS);
    expect(Math.abs(data[at(1.65)]! - 0.25)).toBeLessThan(EPS);
    expect(data.subarray(at(1.8) + 1).every((v) => v === 0)).toBe(true);
  });

  it('a duration shorter than the attack releases from the level reached', async () => {
    // Attack 0.1, release at 0.05 into it: level 0.5, then down to 0 over 0.3 s.
    const data = await render({
      init: SHAPE,
      steps: (env) => env.trigger({ at: 0.5, duration: 0.05 }),
    });
    expect(Math.abs(data[at(0.55)]! - 0.5)).toBeLessThan(EPS);
    expect(Math.abs(data[at(0.7)]! - 0.25)).toBeLessThan(EPS);
    expect(maxOf(data)).toBeLessThan(0.5 + EPS); // never reached 1
    expect(data.subarray(at(0.85) + 1).every((v) => v === 0)).toBe(true);
  });

  it('a release during the attack ramps down from the level reached', async () => {
    const data = await render({
      init: { attack: 0.4, decay: 0.2, sustain: 0.5, release: 0.3 },
      steps: (env) => env.trigger({ at: 0.5 }).release({ at: 0.7 }),
    });
    expect(Math.abs(data[at(0.7)]! - 0.5)).toBeLessThan(EPS); // 0.2 / 0.4 of the way up
    expect(Math.abs(data[at(0.85)]! - 0.25)).toBeLessThan(EPS);
    expect(data.subarray(at(1.0) + 1).every((v) => v === 0)).toBe(true);
    expect(maxOf(data)).toBeLessThan(0.5 + EPS);
  });

  it('a per-trigger override applies to that trigger only', async () => {
    const data = await render({
      init: SHAPE,
      steps: (env) => {
        env.trigger({ at: 0.5, attack: 0.5, sustain: 0.2, decay: 0 });
        env.trigger({ at: 2, release: 0.1, duration: 0.2 });
        expect(env.param('attack').value).toBe(0.1);
      },
    });
    expect(Math.abs(data[at(0.75)]! - 0.5)).toBeLessThan(EPS); // half way through a 0.5 s attack
    expect(Math.abs(data[at(1.0)]! - 0.2)).toBeLessThan(EPS); // no decay: straight to sustain 0.2
    // The second trigger uses the ordinary 0.1 s attack, then releases over the overridden 0.1 s: ending
    // at 2.2 + 0.1 rather than 2.2 + 0.3.
    expect(data.subarray(at(2.3) + 1).every((v) => v === 0)).toBe(true);
  });

  it('reads the parameters when it is triggered', async () => {
    const data = await render({
      init: SHAPE,
      steps: (env) => {
        env.set({ attack: 0.4, sustain: 0.25 });
        env.trigger({ at: 0.5 });
      },
    });
    expect(Math.abs(data[at(0.7)]! - 0.5)).toBeLessThan(EPS);
    expect(Math.abs(data[at(2)]! - 0.25)).toBeLessThan(EPS);
  });

  it('velocity scales every level', async () => {
    const data = await render({
      init: SHAPE,
      steps: (env) => env.trigger({ at: 0.5, velocity: 0.5 }).release({ at: 1.5 }),
    });
    expect(Math.abs(data[at(0.6)]! - 0.5)).toBeLessThan(EPS);
    expect(Math.abs(data[at(0.8)]! - 0.25)).toBeLessThan(EPS);
    expect(Math.abs(data[at(1.5)]! - 0.25)).toBeLessThan(EPS);
    expect(Math.abs(data[at(1.65)]! - 0.125)).toBeLessThan(EPS);
    expect(data.subarray(at(1.8) + 1).every((v) => v === 0)).toBe(true);
  });

  it('a retrigger part way through does not click: it rises from the current level', async () => {
    const data = await render({
      init: SHAPE,
      steps: (env) => env.trigger({ at: 0.5 }).trigger({ at: 0.55 }),
    });
    expect(Math.abs(data[at(0.55)]! - 0.5)).toBeLessThan(EPS);
    expect(Math.abs(data[at(0.65)]! - 1)).toBeLessThan(EPS); // a full 0.1 s attack from there
    expect(Math.abs(data[at(0.85)]! - 0.5)).toBeLessThan(EPS);
    // The largest step between neighbouring samples is the steepest ramp (1 / 0.1 s = 2.1e-4 per
    // sample) and nothing larger.
    expect(maxStep(data, at(0.45), at(1))).toBeLessThan(2.2e-4);
  });

  it('a retrigger during the release rises from the level reached', async () => {
    const data = await render({
      init: SHAPE,
      steps: (env) => env.trigger({ at: 0.5 }).release({ at: 1 }).trigger({ at: 1.15 }),
    });
    expect(Math.abs(data[at(1.15)]! - 0.25)).toBeLessThan(EPS); // half way down the release
    expect(Math.abs(data[at(1.25)]! - 1)).toBeLessThan(EPS);
    expect(maxStep(data, at(0.9), at(1.5))).toBeLessThan(2.2e-4);
  });

  it('attack and decay of 0 jump straight to the level', async () => {
    const data = await render({
      init: { attack: 0, decay: 0, sustain: 0.5, release: 0 },
      steps: (env) => env.trigger({ at: 0.5 }).release({ at: 1 }),
    });
    expect(data[at(0.5) - 1]).toBe(0);
    expect(data[at(0.5)]).toBe(0.5);
    expect(data[at(1) - 1]).toBe(0.5);
    expect(data[at(1)]).toBe(0);
  });

  describe('without cancelAndHoldAtTime (as in Firefox)', () => {
    const native = AudioParam.prototype.cancelAndHoldAtTime;
    afterEach(() => {
      AudioParam.prototype.cancelAndHoldAtTime = native;
    });

    it('renders the same envelopes, retriggers and releases as the native call', async () => {
      const scenarios: Run['steps'][] = [
        (env) => env.trigger({ at: 0.5 }).trigger({ at: 0.55 }).release({ at: 1.3 }),
        (env) => env.trigger({ at: 0.5 }).release({ at: 1 }).trigger({ at: 1.15 }),
        (env) => env.trigger({ at: 0.5, duration: 0.05 }),
        (env) => env.trigger({ at: 0.5, velocity: 0.7 }).trigger({ at: 1.2, duration: 0.5 }),
      ];
      for (const steps of scenarios) {
        const withNative = await render({ init: SHAPE, steps });
        // @ts-expect-error simulating a browser that does not have the method
        AudioParam.prototype.cancelAndHoldAtTime = undefined;
        const without = await render({ init: SHAPE, steps });
        AudioParam.prototype.cancelAndHoldAtTime = native;
        expect(maxDiff(without, withNative)).toBeLessThan(1e-6);
      }
    });
  });
});

function maxStep(data: Float32Array, from: number, to: number): number {
  let max = 0;
  for (let i = from + 1; i < to; i++) max = Math.max(max, Math.abs(data[i]! - data[i - 1]!));
  return max;
}

function maxOf(data: Float32Array): number {
  let max = -Infinity;
  for (const v of data) max = Math.max(max, v);
  return max;
}
