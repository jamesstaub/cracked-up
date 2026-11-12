import { describe, expect, it } from 'vitest';
import { dominantFrequency, findOnsets, rms } from '../helpers';
import { SAMPLE_RATE, click, makeBuffer, offlineEngine, ones, valueAt } from './setup';

describe('sampler', () => {
  it('starts a voice at the exact sample of each trigger, with no stop needed between them', async () => {
    const engine = await offlineEngine(1);
    engine.chain().sampler({ id: 'hit', buffer: click() }).to('main');
    const hit = engine.select('#hit');
    hit.trigger({ at: 0.25 });
    hit.trigger({ at: 0.5 });
    hit.trigger({ at: 0.75 });
    const audio = await engine.render();
    expect(findOnsets(audio, { threshold: 0.5, minGapSamples: 10 })).toEqual([12000, 24000, 36000]);
  });

  it('is silent, without error, until it has a buffer', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().sampler({ id: 'empty' }).to('main');
    engine.select('#empty').trigger({ at: 0 });
    const audio = await engine.render();
    expect(rms(audio)).toBe(0);
  });

  it('shares one store entry between samplers given the same key', async () => {
    const engine = await offlineEngine(0.1);
    const ref = engine.buffers.add('kick', ones(0.1));
    engine.chain().sampler({ id: 'a', buffer: 'kick' }).to('main');
    engine.chain().sampler({ id: 'b', buffer: ref }).to('main');
    engine.select('sampler').trigger({ at: 0 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.05)).toBeCloseTo(2, 6);
    expect(engine.root.describe().nodes.map((node) => node.init)).toEqual([
      { buffer: 'kick' },
      { buffer: 'kick' },
    ]);
  });

  it('plays faster with speed, as a base value or for one trigger', async () => {
    const tone = makeBuffer(1, (_i, t) => Math.sin(2 * Math.PI * 440 * t));
    const base = await offlineEngine(0.4);
    base.chain().sampler({ id: 's', buffer: tone, speed: 2 }).to('main');
    base.select('#s').trigger({ at: 0 });
    expect(dominantFrequency(await base.render())).toBeCloseTo(880, 0);

    const once = await offlineEngine(0.4);
    once.chain().sampler({ id: 's', buffer: tone }).to('main');
    once.select('#s').trigger({ at: 0, speed: 0.5 });
    expect(dominantFrequency(await once.render())).toBeCloseTo(220, 0);
    expect(once.select('#s').param('speed').value).toBe(1);
  });

  it('uses the speed scheduled for the time the voice starts', async () => {
    const tone = makeBuffer(1, (_i, t) => Math.sin(2 * Math.PI * 440 * t));
    const engine = await offlineEngine(0.5);
    engine.chain().sampler({ id: 's', buffer: tone }).to('main');
    const s = engine.select('sampler');
    // Scheduled ahead, as a sequence callback would: the change at 0.25 must not affect the voice at 0.
    s.set({ speed: 2 }, { at: 0.25 });
    s.trigger({ at: 0, duration: 0.2 });
    const audio = await engine.render();
    const early = new AudioBuffer({ length: 0.2 * SAMPLE_RATE, sampleRate: SAMPLE_RATE });
    early.copyToChannel(audio.getChannelData(0).subarray(0, 0.2 * SAMPLE_RATE), 0);
    expect(dominantFrequency(early)).toBeCloseTo(440, 0);
  });

  it('plays only the region between start and end', async () => {
    const engine = await offlineEngine(0.5);
    engine
      .chain()
      .sampler({ id: 's', buffer: ones(1), start: 0.5, end: 0.6 })
      .to('main');
    engine.select('#s').trigger({ at: 0 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.05)).toBeCloseTo(1, 6);
    expect(valueAt(audio, 0.2)).toBe(0);
  });

  it('plays a slice by index, wrapping past the last one', async () => {
    const steps = makeBuffer(1, (_i, t) => (t < 0.5 ? 0.25 : 0.75));
    const engine = await offlineEngine(1);
    const ref = engine.buffers.add('steps', steps);
    ref.slices = [0, 0.5, 1];
    engine.chain().sampler({ id: 's', buffer: ref }).to('main');
    const s = engine.select('sampler');
    s.trigger({ at: 0, slice: 1 });
    s.trigger({ at: 0.6, slice: 2 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.1)).toBeCloseTo(0.75, 6);
    expect(valueAt(audio, 0.55)).toBe(0);
    expect(valueAt(audio, 0.7)).toBeCloseTo(0.25, 6);
  });

  it('reverses', async () => {
    const rising = makeBuffer(0.5, (_i, t) => t * 2);
    const engine = await offlineEngine(0.5);
    engine.chain().sampler({ id: 's', buffer: rising, reverse: true }).to('main');
    engine.select('#s').trigger({ at: 0 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.01)).toBeGreaterThan(0.95);
    expect(valueAt(audio, 0.49)).toBeLessThan(0.05);
  });

  it('loops the region until released', async () => {
    const engine = await offlineEngine(1);
    engine
      .chain()
      .sampler({ id: 's', buffer: ones(0.1), loop: true })
      .to('main');
    const s = engine.select('#s');
    s.trigger({ at: 0 });
    s.release({ at: 0.75 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.5)).toBeCloseTo(1, 6);
    expect(valueAt(audio, 0.9)).toBe(0);
  });

  it('a new trigger cuts off the previous voice by default, and layers when choke is off', async () => {
    const choked = await offlineEngine(1);
    choked
      .chain()
      .sampler({ id: 's', buffer: ones(1) })
      .to('main');
    choked.select('#s').trigger({ at: 0 }).trigger({ at: 0.5 });
    expect(valueAt(await choked.render(), 0.75)).toBeCloseTo(1, 6);

    const layered = await offlineEngine(1);
    layered
      .chain()
      .sampler({ id: 's', buffer: ones(1), choke: false })
      .to('main');
    layered.select('#s').trigger({ at: 0 }).trigger({ at: 0.5 });
    expect(valueAt(await layered.render(), 0.75)).toBeCloseTo(2, 6);
  });

  it('honours duration and velocity for one trigger', async () => {
    const engine = await offlineEngine(1);
    engine
      .chain()
      .sampler({ id: 's', buffer: ones(1) })
      .to('main');
    engine.select('sampler').trigger({ at: 0, duration: 0.25, velocity: 0.5 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.1)).toBeCloseTo(0.5, 6);
    expect(valueAt(audio, 0.3)).toBe(0);
  });
});

describe('sampler voices that stop themselves', () => {
  it('a hit cut short by its duration stays cut short when the next hit comes', async () => {
    const engine = await offlineEngine(0.3);
    engine
      .chain()
      .sampler({ id: 's', buffer: ones(0.3) })
      .to('main');
    // The first hit should sound for 0.02 s only, although the next one is not until 0.1 s.
    engine.select('#s').trigger({ at: 0, duration: 0.02 });
    engine.select('#s').trigger({ at: 0.1, duration: 0.02 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.01)).toBe(1);
    expect(valueAt(audio, 0.05)).toBe(0);
    expect(valueAt(audio, 0.11)).toBe(1);
    expect(valueAt(audio, 0.2)).toBe(0);
  });

  it('a new hit still cuts off one that is ringing', async () => {
    const engine = await offlineEngine(0.3);
    engine
      .chain()
      .sampler({ id: 's', buffer: ones(0.3) })
      .to('main');
    engine.select('#s').trigger({ at: 0, duration: 0.25 });
    engine.select('#s').trigger({ at: 0.1, velocity: 0.5 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.05)).toBe(1);
    expect(valueAt(audio, 0.15)).toBeCloseTo(0.5, 6);
  });
});
