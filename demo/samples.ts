import type { Engine } from '../src';
import { createRandom } from '../src/util';

// --- Samples made in code, so the demo needs no audio files ----------------------------------------

function makeSample(
  context: BaseAudioContext,
  seconds: number,
  fill: (time: number, random: () => number) => number,
): AudioBuffer {
  const length = Math.round(context.sampleRate * seconds);
  const buffer = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: context.sampleRate });
  const data = buffer.getChannelData(0);
  const random = createRandom(1);
  for (let i = 0; i < length; i++)
    data[i] = fill(i / context.sampleRate, () => random.float() * 2 - 1);
  return buffer;
}

export function addSamples(target: Engine): void {
  const context = target.context;
  // Kick: a sine whose pitch falls from 150 Hz to 45 Hz, with a fast decay.
  let phase = 0;
  target.buffers.add(
    'kick',
    makeSample(context, 0.4, (time) => {
      const frequency = 45 + 105 * Math.exp(-time * 30);
      phase += (2 * Math.PI * frequency) / context.sampleRate;
      return Math.sin(phase) * Math.exp(-time * 9);
    }),
  );
  // Snare: noise plus a short 190 Hz tone.
  target.buffers.add(
    'snare',
    makeSample(
      context,
      0.25,
      (time, noise) =>
        noise() * 0.6 * Math.exp(-time * 22) +
        Math.sin(2 * Math.PI * 190 * time) * 0.5 * Math.exp(-time * 30),
    ),
  );
  // Hat: a very short burst of noise.
  target.buffers.add(
    'hat',
    makeSample(context, 0.08, (time, noise) => noise() * Math.exp(-time * 70)),
  );
}
