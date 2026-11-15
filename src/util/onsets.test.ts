import { describe, expect, it } from 'vitest';
import { detectOnsets } from './onsets';
import { createRandom } from './random';
import type { AudioData } from './waveform';

const RATE = 48000;

/** A mono sound filled by adding to an empty one. */
function sound(seconds: number, fill: (data: Float32Array) => void, sampleRate = RATE): AudioData {
  const data = new Float32Array(Math.round(seconds * sampleRate));
  fill(data);
  return { sampleRate, channels: [data] };
}

/** Adds a drum-like hit: noise and a low tone that die away, after an attack of `attack` seconds. */
function hit(
  data: Float32Array,
  at: number,
  { level = 0.8, decay = 0.03, attack = 0.001, tone = 120, seed = 1, sampleRate = RATE } = {},
): void {
  const random = createRandom(seed);
  const from = Math.round(at * sampleRate);
  for (let i = from; i < Math.min(data.length, from + decay * 8 * sampleRate); i++) {
    const t = (i - from) / sampleRate;
    const envelope = Math.min(1, t / attack) * Math.exp(-t / decay);
    data[i]! +=
      level * envelope * (0.5 * (random.float() * 2 - 1) + 0.5 * Math.sin(2 * Math.PI * tone * t));
  }
}

/** Every found time is within `tolerance` seconds of the expected one, and there are no others. */
function expectOnsets(found: number[], expected: number[], tolerance: number): void {
  expect(found.length, `found ${found.join(', ')}`).toBe(expected.length);
  expected.forEach((time, index) => {
    expect(Math.abs(found[index]! - time), `onset ${index} at ${found[index]}`).toBeLessThanOrEqual(
      tolerance,
    );
  });
}

describe('detectOnsets', () => {
  it('finds clicks to the sample', () => {
    const times = [0.1, 0.35, 0.6, 0.9];
    const clicks = sound(1, (data) => {
      for (const time of times) data[Math.round(time * RATE)] = 1;
    });
    expect(detectOnsets(clicks)).toEqual(times);
  });

  it('finds drum-like hits within 1 ms of where they start, a first hit at 0 included', () => {
    const times = [0, 0.25, 0.5, 0.625, 0.75, 1, 1.125, 1.5];
    const drums = sound(2, (data) => {
      times.forEach((time, index) =>
        hit(data, time, {
          seed: index + 1,
          tone: index % 2 ? 200 : 60,
          level: 0.4 + 0.1 * (index % 4),
        }),
      );
    });
    expectOnsets(detectOnsets(drums), times, 0.001);
  });

  it('finds hits with a 5 ms attack within 5 ms', () => {
    const times = [0.1, 0.4, 0.7];
    const soft = sound(1, (data) => times.forEach((time) => hit(data, time, { attack: 0.005 })));
    expectOnsets(detectOnsets(soft), times, 0.005);
  });

  it('finds nothing in silence', () => {
    expect(detectOnsets(sound(1, () => {}))).toEqual([]);
    expect(
      detectOnsets(
        sound(1, () => {}),
        { sensitivity: 1 },
      ),
    ).toEqual([]);
  });

  it('finds nothing in a sustained tone after its start, however sensitive, even as it swells', () => {
    for (const frequency of [40, 110, 440, 3000]) {
      // Sounding from the first sample, growing fivefold over a second, with a slow wobble.
      const tone = sound(2, (data) => {
        for (let i = 0; i < data.length; i++) {
          const t = i / RATE;
          const level = 0.1 + 0.4 * Math.min(1, t) + 0.03 * Math.sin(2 * Math.PI * 3 * t);
          data[i] = level * Math.cos(2 * Math.PI * frequency * t);
        }
      });
      for (const sensitivity of [0, 0.5, 1]) {
        // What is already there at the start is one onset, at 0.
        expect(detectOnsets(tone, { sensitivity }), `${frequency} Hz`).toEqual([0]);
        expect(detectOnsets(tone, { sensitivity, start: 0.2 }), `${frequency} Hz`).toEqual([]);
      }
    }
  });

  it('finds a hi-hat over a held bass note, within 12 ms', () => {
    const times = [0.3, 0.55, 0.8];
    const mix = sound(1.2, (data) => {
      for (let i = 0; i < data.length; i++) {
        const t = i / RATE;
        data[i] = 0.6 * Math.cos(2 * Math.PI * 55 * t);
      }
      times.forEach((time, index) =>
        hit(data, time, { level: 0.2, decay: 0.01, tone: 9000, seed: index + 3 }),
      );
    });
    expectOnsets(detectOnsets(mix), [0, ...times], 0.012);
  });

  it('ignores a noise floor far below the hits', () => {
    const times = [0.2, 0.6];
    const random = createRandom(9);
    const noisy = sound(1, (data) => {
      for (let i = 0; i < data.length; i++) data[i] = 0.0005 * (random.float() * 2 - 1);
      times.forEach((time) => hit(data, time));
    });
    expectOnsets(detectOnsets(noisy), times, 0.001);
  });

  it('finds quieter hits as sensitivity goes up', () => {
    const quiet = sound(1, (data) => {
      hit(data, 0.1, { level: 0.9 });
      // 30 dB down.
      hit(data, 0.5, { level: 0.9 * 10 ** (-30 / 20), seed: 2 });
    });
    expectOnsets(detectOnsets(quiet, { sensitivity: 0 }), [0.1], 0.001);
    expectOnsets(detectOnsets(quiet, { sensitivity: 0.5 }), [0.1, 0.5], 0.001);
  });

  it('keeps onsets at least minGap apart', () => {
    const flam = sound(0.5, (data) => {
      data[Math.round(0.1 * RATE)] = 1;
      data[Math.round(0.13 * RATE)] = 1;
      data[Math.round(0.3 * RATE)] = 1;
    });
    expect(detectOnsets(flam)).toEqual([0.1, 0.3]);
    expect(detectOnsets(flam, { minGap: 0.02 })).toEqual([0.1, 0.13, 0.3]);
  });

  it('looks only between start and end', () => {
    const clicks = sound(1, (data) => {
      for (const time of [0.1, 0.35, 0.6, 0.9]) data[Math.round(time * RATE)] = 1;
    });
    expect(detectOnsets(clicks, { start: 0.2, end: 0.8 })).toEqual([0.35, 0.6]);
  });

  it('gives the same answer every time, at any sample rate, for mono or stereo', () => {
    const times = [0.05, 0.3, 0.55];
    for (const sampleRate of [22050, 44100, 96000]) {
      const mono = sound(
        0.8,
        (data) => times.forEach((time) => hit(data, time, { sampleRate })),
        sampleRate,
      );
      const again = detectOnsets(mono);
      expectOnsets(again, times, 0.001);
      expect(detectOnsets(mono)).toEqual(again);
      const stereo = { sampleRate, channels: [mono.channels[0]!, mono.channels[0]!] };
      expect(detectOnsets(stereo)).toEqual(again);
    }
  });

  it('reads an AudioBuffer', () => {
    const buffer = new AudioBuffer({ length: RATE, numberOfChannels: 1, sampleRate: RATE });
    buffer.getChannelData(0)[RATE / 2] = 1;
    expect(detectOnsets(buffer)).toEqual([0.5]);
  });
});
