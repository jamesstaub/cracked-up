import { describe, expect, it } from 'vitest';
import { findOnsets, rms } from '../helpers';
import { click, makeBuffer, offlineEngine } from '../core/setup';
import { identical, maxDiff, samples, seededEngine } from './util';

async function tail(init: Record<string, unknown>, seconds = 1.5, seed?: number) {
  const engine =
    seed === undefined ? await offlineEngine(seconds) : await seededEngine(seconds, seed);
  engine.chain().sampler({ id: 'in', buffer: click() }).reverb(init).to('main');
  engine.select('#in').trigger({ at: 0 });
  return engine.render();
}

/**
 * WebKit as built for Linux (which is not Safari, and is only what the tests run in there) has a
 * faulty convolver: a click through an impulse of one spike also comes out 128 samples in, and the
 * tail does not end. The tests that read the convolution exactly are skipped where that is found.
 */
async function convolverIsFaulty(): Promise<boolean> {
  const context = new OfflineAudioContext(1, 2048, 48000);
  const spike = new AudioBuffer({ length: 2048, sampleRate: 48000 });
  spike.getChannelData(0)[1000] = 1;
  const one = new AudioBuffer({ length: 1, sampleRate: 48000 });
  one.getChannelData(0)[0] = 1;
  const source = new AudioBufferSourceNode(context, { buffer: one });
  const convolver = new ConvolverNode(context, { buffer: spike, disableNormalization: true });
  source.connect(convolver).connect(context.destination);
  source.start();
  const data = (await context.startRendering()).getChannelData(0);
  return Math.abs(data[128]!) > 0.01;
}
const faultyConvolver = await convolverIsFaulty();

describe('reverb', () => {
  it.skipIf(faultyConvolver)(
    'fades: less energy in the last quarter of the tail than the first',
    async () => {
      const audio = await tail({ seconds: 1, mix: 1 });
      const q = 12000;
      const first = rms(audio, 0, 0, q);
      const last = rms(audio, 0, 3 * q, 4 * q);
      // Measured: first 1.42e-3, last 5.1e-5 (decay 2).
      expect(first).toBeGreaterThan(1e-3);
      expect(last).toBeLessThan(first / 10);
      expect(last).toBeGreaterThan(0);
    },
  );

  it.skipIf(faultyConvolver)('is silent after `seconds`', async () => {
    const audio = await tail({ seconds: 1, mix: 1 });
    // Measured: the largest sample after the tail is 8.7e-12 (rounding in the convolution).
    expect(rms(audio, 0, 48000 + 16)).toBeLessThan(1e-9);
  });

  it('a longer decay value ends the tail sooner', async () => {
    const slow = await tail({ seconds: 1, decay: 1, mix: 1 });
    const fast = await tail({ seconds: 1, decay: 6, mix: 1 });
    // Compare the energy of the second half of the tail relative to the first half.
    const ratio = (audio: AudioBuffer) => rms(audio, 0, 24000, 48000) / rms(audio, 0, 0, 24000);
    expect(ratio(fast)).toBeLessThan(ratio(slow) * 0.5);
  });

  it.skipIf(faultyConvolver)('reverse swells towards the end of the tail', async () => {
    const audio = await tail({ seconds: 1, reverse: true, mix: 1 });
    expect(rms(audio, 0, 36000, 48000)).toBeGreaterThan(rms(audio, 0, 0, 12000) * 10);
  });

  it('is identical across renders with the same seed, and different with another', async () => {
    const a = samples(await tail({ seconds: 0.5, mix: 1 }));
    const b = samples(await tail({ seconds: 0.5, mix: 1 }));
    expect(identical(a, b)).toBe(true);
    const c = samples(await tail({ seconds: 0.5, mix: 1 }, 1.5, 7));
    const d = samples(await tail({ seconds: 0.5, mix: 1 }, 1.5, 8));
    expect(identical(c, d)).toBe(false);
  });

  it('with mix 0 passes the input unchanged', async () => {
    const audio = await tail({ seconds: 0.5, mix: 0 });
    const expected = new Float32Array(audio.length);
    expected[0] = 1;
    expect(maxDiff(samples(audio), expected)).toBe(0);
  });

  it('with mix 0.3 (the default) keeps the dry click at 0.7', async () => {
    const audio = await tail({ seconds: 0.5 });
    // The click is 0.7 dry; the wet tail adds a little at sample 0 as well.
    expect(audio.getChannelData(0)[0]).toBeCloseTo(0.7, 2);
  });

  it.skipIf(faultyConvolver)('uses a given impulse instead of a generated tail', async () => {
    // An impulse that is a single spike 1000 samples in: the output is the click, 1000 samples late.
    const impulse = makeBuffer(0.1, (i) => (i === 1000 ? 1 : 0));
    const audio = await tail({ impulse, mix: 1 }, 0.2);
    expect(findOnsets(audio, { threshold: 0.01, minGapSamples: 100 })).toEqual([1000]);
    expect(rms(audio, 0, 1002)).toBeLessThan(1e-6);
  });

  it.skipIf(faultyConvolver)('uses an impulse that is still loading once it arrives', async () => {
    const engine = await offlineEngine(0.2);
    engine.buffers.add('room', wavSpike(1000, 4800));
    engine
      .chain()
      .sampler({ id: 'in', buffer: click() })
      .reverb({ impulse: 'room', mix: 1 })
      .to('main');
    engine.select('#in').trigger({ at: 0 });
    await engine.buffers.get('room')!.ready;
    const audio = await engine.render();
    expect(findOnsets(audio, { threshold: 0.01, minGapSamples: 100 })).toEqual([1000]);
  });
});

/** A mono 16-bit WAV file, 48 kHz, of silence with one full-scale sample at `at`. */
function wavSpike(at: number, length: number): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 48000, true);
  view.setUint32(28, 96000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, length * 2, true);
  view.setInt16(44 + at * 2, 32767, true);
  return bytes;
}
