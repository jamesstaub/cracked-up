import { describe, expect, it } from 'vitest';
import { createEngine } from '../../src';
import type { Engine, GraphError } from '../../src';
import { encodeWav } from '../../src/util';
import { SAMPLE_RATE, click, makeBuffer, offlineEngine, ones, valueAt } from '../core/setup';

/** A signal whose value says which sample it is: sample n is n / 100000. */
const counting = (seconds: number): AudioBuffer => makeBuffer(seconds, (index) => index / 100000);

/** An engine playing the counting signal from time 0 through a sampler with the id `count`. */
async function countingEngine(seconds: number): Promise<Engine> {
  const engine = await offlineEngine(seconds);
  engine.buffers.add('count', counting(seconds));
  engine.buffers.add('click', click());
  return engine;
}

const frames = (seconds: number): number => Math.round(seconds * SAMPLE_RATE);

describe('recorder', () => {
  it('records exactly the samples between trigger and the end of the duration', async () => {
    const engine = await countingEngine(0.5);
    engine.chain().sampler({ id: 'count', buffer: 'count' }).recorder({ id: 'rec' }).to('main');
    expect(engine.buffers.get('rec')?.state).toBe('loading');
    engine.select('#count').trigger({ at: 0 });
    engine.select('#rec').trigger({ at: 0.1, duration: 0.2 });
    const mix = await engine.render();
    // It passes its input through untouched.
    expect(mix.getChannelData(0)[1234]).toBeCloseTo(0.01234, 7);

    const take = await engine.buffers.get('rec')!.ready;
    expect(take.numberOfChannels).toBe(2);
    expect(take.length).toBe(frames(0.2));
    const data = take.getChannelData(0);
    expect(data[0]).toBeCloseTo(frames(0.1) / 100000, 7);
    expect(data[data.length - 1]).toBeCloseTo((frames(0.3) - 1) / 100000, 7);
    expect(take.getChannelData(1)[100]).toBe(data[100]);
  });

  it('gives recorders triggered together recordings that line up to the sample', async () => {
    const engine = await countingEngine(0.4);
    const source = engine.chain().sampler({ id: 'count', buffer: 'count' });
    source.recorder({ id: 'a', channels: 1 });
    source.gain(0.5).recorder({ id: 'b', channels: 1 });
    engine.select('#count').trigger({ at: 0 });
    engine.select('recorder').trigger({ at: 0.123, duration: 0.1 });
    await engine.render();
    const a = (await engine.buffers.get('a')!.ready).getChannelData(0);
    const b = (await engine.buffers.get('b')!.ready).getChannelData(0);
    expect(a.length).toBe(b.length);
    expect(a.length).toBe(frames(0.1));
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! * 0.5 - b[i]!));
    expect(worst).toBeLessThan(1e-7);
    expect(a[0]).toBeGreaterThan(0);
  });

  it('stops on release, and finishes a take still open when the render ends', async () => {
    // One length that ends on a block boundary (128 samples) and one that does not.
    for (const length of [128 * 100, 128 * 100 + 37]) {
      const context = new OfflineAudioContext(1, length, SAMPLE_RATE);
      const engine = await createEngine({ context });
      engine.buffers.add('ones', ones(1));
      engine
        .chain()
        .sampler({ id: 'dc', buffer: 'ones' })
        .recorder({ id: 'stopped', channels: 1 })
        .recorder({ id: 'open', channels: 1 });
      engine.select('#dc').trigger({ at: 0 });
      engine.select('#stopped').trigger({ at: 0.05 }).release({ at: 0.1 });
      engine.select('#open').trigger({ at: 0.05 });
      await engine.render();
      expect((await engine.buffers.get('stopped')!.ready).length).toBe(frames(0.05));
      const open = await engine.buffers.get('open')!.ready;
      expect(open.length).toBe(length - frames(0.05));
      expect(open.getChannelData(0)[open.length - 1]).toBe(1);
    }
  });

  it('keeps separate takes under separate keys', async () => {
    const engine = await countingEngine(0.5);
    engine.chain().sampler({ id: 'count', buffer: 'count' }).recorder({ id: 'rec', channels: 1 });
    engine.select('#count').trigger({ at: 0 });
    engine.select('#rec').trigger({ at: 0.1, duration: 0.05, key: 'first' });
    engine.select('#rec').trigger({ at: 0.3, duration: 0.1, key: 'second' });
    await engine.render();
    const first = await engine.buffers.get('first')!.ready;
    const second = await engine.buffers.get('second')!.ready;
    expect(first.length).toBe(frames(0.05));
    expect(second.length).toBe(frames(0.1));
    expect(first.getChannelData(0)[0]).toBeCloseTo(frames(0.1) / 100000, 7);
    expect(second.getChannelData(0)[0]).toBeCloseTo(frames(0.3) / 100000, 7);
  });

  it('shifts the recording by the latency, so a late input lines up', async () => {
    const engine = await countingEngine(0.4);
    engine
      .chain()
      .sampler({ id: 'count', buffer: 'count' })
      .recorder({ id: 'rec', channels: 1, latency: 0.01 });
    engine.select('#count').trigger({ at: 0 });
    engine.select('#rec').trigger({ at: 0.1, duration: 0.1 });
    await engine.render();
    const take = await engine.buffers.get('rec')!.ready;
    expect(take.length).toBe(frames(0.1));
    expect(take.getChannelData(0)[0]).toBeCloseTo(frames(0.11) / 100000, 7);
  });

  it('makes stems: one recorder per bus, all the length of the render', async () => {
    const engine = await offlineEngine(0.3);
    engine.buffers.add('ones', ones(0.3));
    const drums = engine.scope('drums');
    const bass = engine.scope('bass');
    drums.bus('out').chain().recorder({ id: 'stem', into: 'stem:drums', channels: 1 });
    bass.bus('out').chain().recorder({ id: 'stem', into: 'stem:bass', channels: 1 });
    drums.chain().sampler({ id: 'dc', buffer: 'ones' }).gain(0.25).to('out');
    bass.chain().sampler({ id: 'dc', buffer: 'ones' }).gain(0.5).to('out');
    engine.select('sampler').trigger({ at: 0 });
    engine.select('recorder').trigger({ at: 0 });
    const mix = await engine.render();
    const drumStem = await engine.buffers.get('stem:drums')!.ready;
    const bassStem = await engine.buffers.get('stem:bass')!.ready;
    expect(drumStem.length).toBe(mix.length);
    expect(bassStem.length).toBe(mix.length);
    expect(valueAt(drumStem, 0.1)).toBeCloseTo(0.25, 6);
    expect(valueAt(bassStem, 0.1)).toBeCloseTo(0.5, 6);
    expect(valueAt(mix, 0.1)).toBeCloseTo(0.75, 6);
  });
});

describe('looper', () => {
  /** A looper fed by single-sample clicks at the given times, with only the loop on its output. */
  async function loopOf(seconds: number, clicks: readonly number[], init: Record<string, unknown>) {
    const engine = await countingEngine(seconds);
    engine
      .chain()
      .sampler({ id: 'src', buffer: 'click', choke: false })
      .looper({ id: 'loop', channels: 1, monitor: 0, ...init })
      .to('main');
    for (const at of clicks) engine.select('#src').trigger({ at });
    return engine;
  }

  /** The sample indexes at which the output is not silent. */
  const hits = (audio: AudioBuffer): number[] => {
    const data = audio.getChannelData(0);
    const found: number[] = [];
    for (let i = 0; i < data.length; i++) if (Math.abs(data[i]!) > 0.5) found.push(i);
    return found;
  };

  it('records one loop and repeats it', async () => {
    // At 120 bpm, 0.2 beats is 0.1 seconds: 4800 samples.
    const engine = await loopOf(0.55, [0.12], { length: 0.2 });
    engine.select('#loop').trigger({ at: 0.1 });
    const audio = await engine.render();
    expect(hits(audio)).toEqual([0.22, 0.32, 0.42, 0.52].map(frames));
  });

  it('adds layers, removes the newest with undo, and empties with clear', async () => {
    const engine = await loopOf(1.05, [0.12, 0.35], { length: 0.2 });
    const loop = engine.select('#loop');
    loop.trigger({ at: 0.1 });
    loop.trigger({ at: 0.3 });
    loop.call('undo', {}, { at: 0.6 });
    loop.call('clear', {}, { at: 0.8 });
    const audio = await engine.render();
    expect(hits(audio)).toEqual([0.22, 0.32, 0.42, 0.45, 0.52, 0.55, 0.62, 0.72].map(frames));
  });

  it('keeps recording round the loop until released when asked to', async () => {
    const engine = await loopOf(0.65, [0.12, 0.27], { length: 0.2 });
    engine.select('#loop').trigger({ at: 0.1, cycles: 0 }).release({ at: 0.3 });
    const audio = await engine.render();
    // The second click was played in the second time round, at 0.07 into the loop.
    expect(hits(audio)).toEqual([0.22, 0.32, 0.37, 0.42, 0.47, 0.52, 0.57, 0.62].map(frames));
  });

  it('silences and restores playback without losing its place', async () => {
    const engine = await loopOf(0.65, [0.12], { length: 0.2 });
    const loop = engine.select('#loop');
    loop.trigger({ at: 0.1 });
    loop.call('stop', {}, { at: 0.3 }).call('play', {}, { at: 0.5 });
    expect(hits(await engine.render())).toEqual([0.22, 0.52, 0.62].map(frames));
  });

  it('passes its input through at the monitor level', async () => {
    const engine = await loopOf(0.3, [0.05], { length: 0.2, monitor: 0.5 });
    const audio = await engine.render();
    expect(audio.getChannelData(0)[frames(0.05)]).toBeCloseTo(0.5, 6);
  });

  it('stays in phase for 100 cycles when the loop is not a whole number of samples', async () => {
    // 480.37 samples per loop. Cycle k starts at the sample nearest to k * 480.37 after the start.
    const exact = 480.37;
    const beats = (exact / SAMPLE_RATE) * 2;
    const start = frames(0.1);
    const engine = await loopOf(1.2, [(start + 10) / SAMPLE_RATE], { length: beats });
    engine.select('#loop').trigger({ at: start / SAMPLE_RATE });
    const found = hits(await engine.render());
    expect(found.length).toBeGreaterThan(100);
    for (let k = 1; k <= 100; k++) {
      expect(found[k - 1]).toBe(start + Math.round(k * exact) + 10);
    }
  });

  it('writes a late input where the loop was when it was played', async () => {
    // The click reaches the looper 0.01 s after it was "played" at 0.02 s into the loop.
    const engine = await loopOf(0.45, [0.13], { length: 0.2, latency: 0.01 });
    engine.select('#loop').trigger({ at: 0.1 });
    expect(hits(await engine.render())).toEqual([0.22, 0.32, 0.42].map(frames));
  });
});

describe('input', () => {
  it('cannot be made in an offline engine', async () => {
    const engine = await offlineEngine(0.1);
    expect(() => engine.chain().input()).toThrow(/offline engine has no live input/);
  });

  it('uses a stream it is given, and lets go of it when disposed', async () => {
    const context = new AudioContext();
    try {
      const engine = await createEngine({ context });
      const stream = new MediaStreamAudioDestinationNode(context).stream;
      engine.chain().input({ id: 'mic', stream, gain: 0.5 }).to('main');
      const node = engine.select('#mic').first()!;
      expect(node.param('gain').value).toBe(0.5);
      node.dispose();
      // A stream the host supplied is the host's to stop.
      expect(stream.getAudioTracks()[0]?.readyState).toBe('live');
      engine.dispose();
    } finally {
      await context.close();
    }
  });

  const isChromium = /Chrome\//.test(navigator.userAgent);

  // Needs sound without a click and a microphone, which the test setup provides only in Chromium.
  it.skipIf(!isChromium)('records a live input in real time', async () => {
    const context = new AudioContext();
    try {
      await context.resume();
      const engine = await createEngine({ context });
      const errors: GraphError[] = [];
      engine.on('error', (error) => errors.push(error));
      engine.chain().input({ id: 'mic' }).recorder({ id: 'rec', channels: 1 });
      // Give the pretend microphone a moment to open, then record 0.6 seconds of it.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const start = context.currentTime + 0.05;
      engine.select('#rec').trigger({ at: start, duration: 0.6 });
      const take = await engine.buffers.get('rec')!.ready;
      expect(errors).toEqual([]);
      expect(take.length).toBe(
        Math.round((start + 0.6) * context.sampleRate) - Math.round(start * context.sampleRate),
      );
      expect(take.sampleRate).toBe(context.sampleRate);
      engine.dispose();
    } finally {
      await context.close();
    }
  });
});

describe('encodeWav', () => {
  const audio = (): AudioBuffer => {
    const buffer = new AudioBuffer({ length: 4, numberOfChannels: 2, sampleRate: 44100 });
    buffer.getChannelData(0).set([0, 0.5, -0.5, 2]);
    buffer.getChannelData(1).set([1, -1, 0.25, -2]);
    return buffer;
  };

  it('writes a 16-bit file with a correct header, clipping what is too loud', () => {
    const view = new DataView(encodeWav(audio()));
    const text = (offset: number) =>
      String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(offset + i)));
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.byteLength).toBe(44 + 4 * 2 * 2);
    expect(view.getUint32(4, true)).toBe(view.byteLength - 8);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(16);
    const samples = Array.from({ length: 8 }, (_, i) => view.getInt16(44 + i * 2, true));
    // Interleaved: left, right, left, right...
    expect(samples).toEqual([0, 32767, 16384, -32767, -16383, 8192, 32767, -32767]);
  });

  it('writes 24-bit and floating-point files', () => {
    const wide = new DataView(encodeWav(audio(), { bitDepth: 24 }));
    expect(wide.getUint16(34, true)).toBe(24);
    expect(wide.byteLength).toBe(44 + 4 * 2 * 3);
    const second = wide.getUint8(47) | (wide.getUint8(48) << 8) | (wide.getUint8(49) << 16);
    expect(second).toBe(8388607);

    const float = new DataView(encodeWav(audio(), { bitDepth: 32 }));
    expect(float.getUint16(20, true)).toBe(3);
    expect(float.getFloat32(44 + 6 * 4, true)).toBe(2);
    expect(() => encodeWav(audio(), { bitDepth: 8 as 16 })).toThrow(/16, 24 or 32/);
  });

  it('makes files the browser can read back', async () => {
    const source = makeBuffer(0.05, (_index, time) => Math.sin(2 * Math.PI * 440 * time) * 0.8);
    const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    for (const bitDepth of [16, 24, 32] as const) {
      const decoded = await context.decodeAudioData(encodeWav(source, { bitDepth }));
      expect(decoded.length).toBe(source.length);
      expect(decoded.sampleRate).toBe(SAMPLE_RATE);
      const a = source.getChannelData(0);
      const b = decoded.getChannelData(0);
      let worst = 0;
      for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
      expect(worst).toBeLessThan(bitDepth === 16 ? 1e-4 : 1e-6);
    }
  });
});
