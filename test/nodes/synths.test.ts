import { describe, expect, it } from 'vitest';
import { createEngine, defineMacro } from '../../src';
import type { Engine, MacroDefinition, ScopeApi } from '../../src';
import { findOnsets } from '../helpers';
import { SAMPLE_RATE, offlineEngine } from '../core/setup';
import { goertzel, samples } from './util';

const at = (seconds: number) => Math.round(seconds * SAMPLE_RATE);
const between = (data: Float32Array, from: number, to: number) => data.subarray(at(from), at(to));
const peak = (data: Float32Array) => data.reduce((max, v) => Math.max(max, Math.abs(v)), 0);

/** The frequency near `centre` (within 10%) with the most energy, by scanning in 0.25% steps. */
function peakFrequency(data: Float32Array, centre: number): number {
  let best = centre;
  let bestMagnitude = -1;
  for (let ratio = 0.9; ratio <= 1.1; ratio += 0.0025) {
    const magnitude = goertzel(data, centre * ratio);
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      best = centre * ratio;
    }
  }
  return best;
}

/** Combined magnitude of the harmonics of `f0` at or above `fromHz`: a measure of brightness. */
function highEnergy(data: Float32Array, f0: number, fromHz: number): number {
  let sum = 0;
  for (let k = 1; k * f0 < 20000; k++) {
    if (k * f0 >= fromHz) sum += goertzel(data, k * f0) ** 2;
  }
  return Math.sqrt(sum);
}

/** Frequency of a clean tone from its first to its last rising zero crossing. */
function crossingFrequency(data: Float32Array): number {
  const c = crossings(data);
  return ((c.length - 1) * SAMPLE_RATE) / (c[c.length - 1]! - c[0]!);
}

/** Rising zero crossings, as sample positions. */
function crossings(data: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 1; i < data.length; i++) if (data[i - 1]! < 0 && data[i]! >= 0) out.push(i);
  return out;
}

/** A clean, fully open voice: no filtering to speak of, instant attack, full sustain. */
const CLEAN = { shape: 'sine', cutoff: 20000, attack: 0, decay: 0, sustain: 1, gain: 1 } as const;

type Init = Record<string, number | string>;

async function mono(seconds: number, init: Init = {}) {
  const engine = await offlineEngine(seconds);
  engine
    .chain()
    .monosynth({ id: 'synth', ...CLEAN, ...init })
    .to('main');
  return { engine, synth: engine.select('#synth') };
}

async function poly(seconds: number, init: Init = {}) {
  const engine = await offlineEngine(seconds);
  engine
    .chain()
    .polysynth({ id: 'synth', ...CLEAN, gain: 0.5, ...init })
    .to('main');
  return { engine, synth: engine.select('#synth') };
}

const render = async (engine: Engine) => samples(await engine.render());
const voiceCount = (engine: Engine, id = 'synth') => engine.select(`#${id} .osc`).length;

// ---------------------------------------------------------------------------------------------------

describe('monosynth', () => {
  it('is silent until triggered, and silent if never triggered', async () => {
    const { synth, engine } = await mono(1, { shape: 'saw' });
    synth.trigger({ pitch: 57, at: 0.5 });
    const data = await render(engine);
    expect(peak(between(data, 0, 0.499))).toBeLessThan(1e-6);
    expect(peak(between(data, 0.5, 0.7))).toBeGreaterThan(0.1);

    const silent = await mono(0.5, { shape: 'saw' });
    expect(peak(await render(silent.engine))).toBe(0);
  });

  it('plays the pitch it is given, including fractional pitches', async () => {
    for (const [pitch, hz] of [
      [69, 440],
      [57, 220],
      [81, 880],
      [60.5, 440 * 2 ** ((60.5 - 69) / 12)],
    ] as const) {
      const { synth, engine } = await mono(1);
      synth.trigger({ pitch, at: 0 });
      const found = crossingFrequency(between(await render(engine), 0.1, 0.9));
      // Measured error: under 0.001% (a sine's zero crossings), against a 1% tolerance.
      expect(Math.abs(found / hz - 1)).toBeLessThan(0.01);
    }
  });

  it('every shape sounds, at the pitch asked', async () => {
    for (const shape of ['sine', 'saw', 'square', 'triangle']) {
      const { synth, engine } = await mono(0.6, { shape });
      synth.trigger({ pitch: 57, at: 0 });
      const data = between(await render(engine), 0.1, 0.5);
      expect(peak(data), shape).toBeGreaterThan(0.2);
      expect(Math.abs(peakFrequency(data, 220) / 220 - 1), shape).toBeLessThan(0.01);
    }
  });

  it('duration ends the note, after the release time', async () => {
    const { synth, engine } = await mono(1, { release: 0.1 });
    synth.trigger({ pitch: 69, duration: 0.3, at: 0.1 });
    const data = await render(engine);
    expect(peak(between(data, 0.2, 0.39))).toBeGreaterThan(0.9);
    // Released at 0.4, silent exactly at 0.5.
    expect(peak(between(data, 0.51, 1))).toBe(0);
    expect(peak(between(data, 0.4, 0.45))).toBeGreaterThan(0.3);
  });

  it('a second trigger moves the pitch at the exact time, without a second voice', async () => {
    const { synth, engine } = await mono(1);
    synth.trigger({ pitch: 57, at: 0 }); // 220 Hz
    synth.trigger({ pitch: 69, at: 0.5 }); // 440 Hz
    const data = await render(engine);
    const before = crossings(data.subarray(at(0.5) - 480, at(0.5)));
    const after = crossings(data.subarray(at(0.5), at(0.5) + 480));
    // 10 ms is 2.2 cycles at 220 Hz and 4.4 at 440 Hz. A change one cycle late or early would show.
    expect([before.length]).toEqual([expect.toBeOneOf([2, 3])]);
    expect([after.length]).toEqual([expect.toBeOneOf([4, 5])]);
    expect(Math.abs(peakFrequency(between(data, 0.1, 0.45), 220) / 220 - 1)).toBeLessThan(0.01);
    expect(Math.abs(peakFrequency(between(data, 0.55, 0.95), 440) / 440 - 1)).toBeLessThan(0.01);
    expect(peak(data)).toBeLessThan(1.01);
  });

  it('velocity scales the level', async () => {
    const level = async (velocity: number) => {
      const { synth, engine } = await mono(0.5);
      synth.trigger({ pitch: 69, velocity, at: 0 });
      return peak(between(await render(engine), 0.1, 0.4));
    };
    const full = await level(1);
    const half = await level(0.5);
    // Measured ratio: 0.5000.
    expect(half / full).toBeGreaterThan(0.49);
    expect(half / full).toBeLessThan(0.51);
  });

  it('cutoff reaches the filter: a low cutoff takes the highs out of a saw', async () => {
    const bright = async (cutoff: number) => {
      const { synth, engine } = await mono(0.5, { shape: 'saw', cutoff });
      synth.trigger({ pitch: 57, at: 0 });
      return highEnergy(between(await render(engine), 0.1, 0.4), 220, 2000);
    };
    const dark = await bright(200);
    const open = await bright(8000);
    // Measured (Chromium): energy above 2 kHz is 0.0007 at cutoff 200 and 0.173 at 8000, a ratio of
    // about 250; the test asks for 50.
    expect(open).toBeGreaterThan(0.05);
    expect(dark).toBeLessThan(open / 50);

    // Changing it later reaches the same filter.
    const { synth, engine } = await mono(1, { shape: 'saw', cutoff: 8000 });
    synth.trigger({ pitch: 57, at: 0 });
    synth.set({ cutoff: 200 }, { at: 0.5 });
    expect(engine.select('#synth #filter').param('frequency').value).toBe(200);
    const data = await render(engine);
    expect(highEnergy(between(data, 0.6, 0.9), 220, 2000)).toBeLessThan(
      highEnergy(between(data, 0.1, 0.4), 220, 2000) / 50,
    );
  });

  it('set({ release }) then release() fades over that time', async () => {
    const { synth, engine } = await mono(2, { release: 0.2 });
    synth.set({ release: 1 });
    synth.trigger({ pitch: 69, at: 0 });
    synth.release({ at: 0.5 });
    const data = await render(engine);
    const level = (from: number) => peak(between(data, from, from + 0.01));
    const full = level(0.4);
    // Linear fade from 0.5 to 1.5 s: half way down at 1.0, nothing left at 1.5. Measured: 0.4993 at
    // 1.0 s and 0.7492 at 0.75 s, relative to the held level; exact silence after 1.5 s.
    expect(level(1.0) / full).toBeGreaterThan(0.45);
    expect(level(1.0) / full).toBeLessThan(0.55);
    expect(level(0.75) / full).toBeGreaterThan(0.7);
    expect(level(0.75) / full).toBeLessThan(0.8);
    expect(peak(between(data, 1.51, 2))).toBe(0);
  });

  it('requires a pitch', async () => {
    const { synth, engine } = await mono(0.1);
    const errors: string[] = [];
    engine.on('error', (error) => errors.push(error.message));
    expect(() => synth.trigger({})).toThrowError(/pitch/);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('polysynth', () => {
  it('two pitches sound together', async () => {
    const { synth, engine } = await poly(1);
    synth.trigger({ pitch: 60, at: 0 });
    synth.trigger({ pitch: 67, at: 0 });
    const data = between(await render(engine), 0.2, 0.7);
    const c = 440 * 2 ** ((60 - 69) / 12);
    const g = 440 * 2 ** ((67 - 69) / 12);
    // Measured: 0.5 each (gain 0.5 scales the unit sine), nothing at a pitch in between.
    expect(goertzel(data, c)).toBeGreaterThan(0.45);
    expect(goertzel(data, g)).toBeGreaterThan(0.45);
    expect(goertzel(data, 300)).toBeLessThan(0.02);
    expect(voiceCount(engine)).toBe(2);
  });

  it('releasing one pitch leaves the other; release with no pitch ends all', async () => {
    const { synth, engine } = await poly(2, { release: 0.1 });
    synth.trigger({ pitch: 60, at: 0 });
    synth.trigger({ pitch: 67, at: 0 });
    synth.release({ pitch: 60, at: 0.5 });
    synth.release({ at: 1.2 });
    const data = await render(engine);
    const c = 440 * 2 ** ((60 - 69) / 12);
    const g = 440 * 2 ** ((67 - 69) / 12);
    const middle = between(data, 0.7, 1.1);
    expect(goertzel(middle, c)).toBeLessThan(0.02);
    expect(goertzel(middle, g)).toBeGreaterThan(0.45);
    expect(peak(between(data, 1.31, 2))).toBe(0);
    expect(peak(between(data, 1.1, 1.2))).toBeGreaterThan(0.3);
  });

  it('retriggering a held pitch does not add a voice', async () => {
    const { synth, engine } = await poly(1);
    synth.trigger({ pitch: 60, at: 0 });
    synth.trigger({ pitch: 60, at: 0.3 });
    synth.trigger({ pitch: 60, at: 0.6 });
    expect(voiceCount(engine)).toBe(1);
    const data = await render(engine);
    // One voice at 0.5: not summed to 1.0.
    expect(peak(between(data, 0.7, 0.9))).toBeLessThan(0.52);
    expect(peak(between(data, 0.7, 0.9))).toBeGreaterThan(0.45);
  });

  it('with voices: 2, a third note takes over the oldest', async () => {
    const { synth, engine } = await poly(1.5, { voices: 2, release: 0.05 });
    synth.trigger({ pitch: 60, at: 0 });
    synth.trigger({ pitch: 64, at: 0.2 });
    synth.trigger({ pitch: 67, at: 0.4 });
    const data = await render(engine);
    const hz = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);
    const early = between(data, 0.25, 0.39);
    expect(goertzel(early, hz(60))).toBeGreaterThan(0.4);
    const late = between(data, 0.6, 1.4);
    // Measured: the stolen note leaves under 0.01; the others stay at about 0.5.
    expect(goertzel(late, hz(60))).toBeLessThan(0.02);
    expect(goertzel(late, hz(64))).toBeGreaterThan(0.45);
    expect(goertzel(late, hz(67))).toBeGreaterThan(0.45);
  });

  for (const release of [0.02, 0.5]) {
    it(`keeps the voice nodes bounded by \`voices\` over 200 notes (release ${release} s), with no timers`, async () => {
      const voices = 4;
      const { engine } = await poly(7, { voices, release });
      let most = 0;
      let triggered = 0;
      engine.transport.sequence({ steps: 200, step: '1/64' }, (ev) => {
        if (ev.cycle > 0) return; // the pattern loops; only the first 200 notes are the test
        engine.select('#synth').trigger({ pitch: 48 + (ev.index % 24), duration: 0.01 });
        triggered++;
        most = Math.max(most, voiceCount(engine));
      });
      engine.transport.start();
      const data = await render(engine);
      expect(triggered).toBe(200);
      expect(voiceCount(engine)).toBeLessThanOrEqual(voices);
      expect(most).toBeLessThanOrEqual(voices);
      // Reusing voices must not lose notes: sound is present through the whole run.
      for (let step = 0; step < 200; step += 10) {
        const from = (step * 0.5) / 16;
        expect(peak(between(data, from, from + 0.03)), `step ${step}`).toBeGreaterThan(0.05);
      }
    });
  }

  it('a voice that has finished is reused for the next note, at the new pitch', async () => {
    const { synth, engine } = await poly(2, { release: 0.1 });
    synth.trigger({ pitch: 57, duration: 0.2, at: 0 });
    synth.trigger({ pitch: 69, duration: 0.2, at: 0.5 });
    synth.trigger({ pitch: 81, duration: 0.2, at: 1 });
    expect(voiceCount(engine)).toBe(1);
    const data = await render(engine);
    for (const [from, hz] of [
      [0.05, 220],
      [0.55, 440],
      [1.05, 880],
    ] as const) {
      expect(Math.abs(peakFrequency(between(data, from, from + 0.2), hz) / hz - 1)).toBeLessThan(
        0.01,
      );
    }
    // The gaps between them are silent.
    expect(peak(between(data, 0.31, 0.5))).toBe(0);
    expect(peak(between(data, 0.81, 1))).toBe(0);
  });

  it('cutoff set after voices exist reaches them, and later voices start with it', async () => {
    const run = async (change: boolean) => {
      const { synth, engine } = await poly(2, { shape: 'saw', cutoff: 8000 });
      synth.trigger({ pitch: 57, at: 0 });
      synth.release({ at: 0.9 });
      if (change) synth.set({ cutoff: 200 }, { at: 0.5 });
      synth.trigger({ pitch: 64, at: 1.1 });
      const data = await render(engine);
      const hz64 = 440 * 2 ** ((64 - 69) / 12);
      return {
        existing: highEnergy(between(data, 0.6, 0.85), 220, 2000),
        existingBefore: highEnergy(between(data, 0.1, 0.4), 220, 2000),
        later: highEnergy(between(data, 1.3, 1.9), hz64, 2000),
      };
    };
    const changed = await run(true);
    const unchanged = await run(false);
    expect(unchanged.existing).toBeGreaterThan(0.05);
    expect(changed.existingBefore).toBeGreaterThan(0.05);
    expect(changed.existing).toBeLessThan(changed.existingBefore / 50);
    expect(unchanged.later).toBeGreaterThan(0.05);
    expect(changed.later).toBeLessThan(unchanged.later / 50);
    // The new voice's filter really was made with the new value.
  });

  it('a voice made after set() starts with the changed settings', async () => {
    const { synth, engine } = await poly(1);
    synth.set({ cutoff: 300, resonance: 3, attack: 0.2, release: 0.7, detune: 25 });
    synth.trigger({ pitch: 60, at: 0 });
    const voice = engine.select('#synth .v1');
    expect(voice.length).toBe(3);
    expect(engine.select('#synth .filter').param('frequency').value).toBe(300);
    expect(engine.select('#synth .filter').param('q').value).toBe(3);
    expect(engine.select('#synth .env').param('attack').value).toBe(0.2);
    expect(engine.select('#synth .env').param('release').value).toBe(0.7);
    expect(engine.select('#synth .osc').param('detune').value).toBe(25);
  });

  it('lfoDepth makes the pitch wobble, for voices made before and after the change', async () => {
    const wobble = async (depth: number, early: boolean) => {
      const { synth, engine } = await poly(1.2, { lfoRate: 5 });
      if (early) synth.trigger({ pitch: 69, at: 0 });
      synth.set({ lfoDepth: depth });
      if (!early) synth.trigger({ pitch: 69, at: 0 });
      const data = between(await render(engine), 0.2, 1.1);
      const cross = crossings(data);
      const periods = cross.slice(1).map((c, i) => SAMPLE_RATE / (c - cross[i]!));
      return {
        steady: goertzel(data, 440),
        low: Math.min(...periods),
        high: Math.max(...periods),
      };
    };
    const still = await wobble(0, true);
    expect(still.steady).toBeGreaterThan(0.45);
    // One sample of timing is 4 Hz at 440 Hz, so a steady tone reads within about 10 Hz.
    expect(still.high - still.low).toBeLessThan(10);
    for (const early of [true, false]) {
      const moving = await wobble(50, early);
      // Measured swing (crossing to crossing): 390 to 490 Hz for a depth of 50, 436 to 440 without.
      expect(moving.high).toBeGreaterThan(470);
      expect(moving.low).toBeLessThan(410);
      expect(moving.high).toBeLessThan(500);
      expect(moving.low).toBeGreaterThan(380);
      expect(moving.steady).toBeLessThan(still.steady / 2);
    }
  });

  it('two instances are independent', async () => {
    const engine = await offlineEngine(2);
    for (const id of ['a', 'b']) {
      engine
        .chain()
        .polysynth({ id, ...CLEAN, voices: 1, release: 0.05 })
        .to('main');
    }
    engine.select('#a').trigger({ pitch: 60, at: 0 });
    engine.select('#b').trigger({ pitch: 67, at: 0.1 }); // would steal a's only voice if shared
    engine.select('#a').release({ at: 1 });
    engine.select('#b').set({ cutoff: 500 });
    expect(engine.select('#a .filter').param('frequency').value).toBe(20000);
    expect(engine.select('#b .filter').param('frequency').value).toBe(500);
    expect(voiceCount(engine, 'a')).toBe(1);
    expect(voiceCount(engine, 'b')).toBe(1);
    const data = await render(engine);
    const c = 440 * 2 ** ((60 - 69) / 12);
    const g = 440 * 2 ** ((67 - 69) / 12);
    const early = between(data, 0.3, 0.9);
    expect(goertzel(early, c)).toBeGreaterThan(0.4);
    expect(goertzel(early, g)).toBeGreaterThan(0.1);
    const late = between(data, 1.2, 1.9);
    expect(goertzel(late, c)).toBeLessThan(0.02);
    expect(goertzel(late, g)).toBeGreaterThan(0.1);
  });

  it('notes from a sequence callback with no `at` start on the exact step', async () => {
    const { engine } = await poly(2.1, { shape: 'square', attack: 0, release: 0.01 });
    engine.transport.sequence({ steps: 4, step: '1/4', offset: '1/4' }, () => {
      engine.select('#synth').trigger({ pitch: 57, duration: 0.1 });
    });
    engine.transport.start();
    const data = await render(engine);
    const onsets = findOnsets({ getChannelData: () => data } as unknown as AudioBuffer, {
      threshold: 0.05,
      minGapSamples: 100,
    });
    // At 120 bpm a quarter note is 0.5 s. Chromium renders every onset on the exact sample; Firefox
    // puts the notes after the first (which reuse a voice) one sample late, so the check allows 1
    // sample (21 microseconds), where a scheduling error would be at least a whole step.
    expect(onsets).toHaveLength(4);
    onsets.forEach((onset, i) => {
      expect(Math.abs(onset - 24000 * (i + 1))).toBeLessThanOrEqual(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------------

describe('noteOn and noteOff', () => {
  for (const type of ['monosynth', 'polysynth'] as const) {
    it(`${type}: work as commands, like trigger and release`, async () => {
      const engine = await offlineEngine(2);
      const chain = engine.chain();
      chain[type]({ id: 'synth', ...CLEAN, release: 0.05 }).to('main');
      engine.root.dispatch([
        { op: 'call', target: '#synth', method: 'noteOn', args: { pitch: 69 }, at: 0.5 },
        { op: 'call', target: '#synth', method: 'noteOff', args: { pitch: 69 }, at: 1 },
        {
          op: 'call',
          target: '#synth',
          method: 'noteOn',
          args: { pitch: 57, velocity: 0.5, duration: 0.2 },
          at: 1.2,
        },
      ]);
      const data = await render(engine);
      expect(peak(between(data, 0, 0.499))).toBeLessThan(1e-6);
      expect(Math.abs(peakFrequency(between(data, 0.6, 0.95), 440) / 440 - 1)).toBeLessThan(0.01);
      expect(peak(between(data, 0.6, 0.95))).toBeGreaterThan(0.45);
      expect(peak(between(data, 1.06, 1.19))).toBe(0);
      // Velocity 0.5 on a gain of 1 (the monosynth has 1, the polysynth 1).
      expect(peak(between(data, 1.25, 1.35))).toBeGreaterThan(0.45);
      expect(peak(between(data, 1.25, 1.35))).toBeLessThan(0.55);
      expect(peak(between(data, 1.5, 2))).toBe(0);
    });
  }

  it('polysynth noteOff with no pitch releases everything', async () => {
    const { engine } = await poly(1.5, { release: 0.05 });
    engine.root.dispatch([
      { op: 'call', target: '#synth', method: 'noteOn', args: { pitch: 60 }, at: 0 },
      { op: 'call', target: '#synth', method: 'noteOn', args: { pitch: 67 }, at: 0 },
      { op: 'call', target: '#synth', method: 'noteOff', args: {}, at: 0.5 },
    ]);
    const data = await render(engine);
    expect(peak(between(data, 0.3, 0.5))).toBeGreaterThan(0.5);
    expect(peak(between(data, 0.56, 1.5))).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------

describe('macro instance identity', () => {
  it('the scope handed to build, trigger, release and methods is one object per instance', async () => {
    // Build records which instance a scope belongs to; the other calls look the scope up. A scope that
    // was not the one seen in build would come back unknown.
    const names = new WeakMap<ScopeApi, string>();
    const calls: string[] = [];
    const probe: MacroDefinition = defineMacro({
      type: 'probe',
      params: {},
      build(__, init) {
        names.set(__, String(init['name']));
        __().gain({ id: 'g' }).to('out');
      },
      trigger: (__) => void calls.push(`${names.get(__) ?? 'unknown'} trigger`),
      release: (__) => void calls.push(`${names.get(__) ?? 'unknown'} release`),
      methods: { ping: (__) => void calls.push(`${names.get(__) ?? 'unknown'} ping`) },
    });
    const context = new OfflineAudioContext(1, 4800, SAMPLE_RATE);
    const engine = await createEngine({ context, nodes: [probe] });
    const chain = engine.chain() as unknown as Record<string, (init: object) => unknown>;
    chain['probe']!({ id: 'p1', name: 'one' });
    chain['probe']!({ id: 'p2', name: 'two' });
    for (const id of ['#p1', '#p2']) {
      engine.select(id).trigger({});
      engine.select(id).release({});
      engine.select(id).call('ping');
    }
    expect(calls).toEqual([
      'one trigger',
      'one release',
      'one ping',
      'two trigger',
      'two release',
      'two ping',
    ]);
  });
});
