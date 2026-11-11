import { createEngine } from '../../src';
import type { Engine } from '../../src';

export const SAMPLE_RATE = 48000;

/** An engine on an offline context of the given length, mono unless asked otherwise. */
export async function offlineEngine(seconds: number, channels = 1): Promise<Engine> {
  const context = new OfflineAudioContext(channels, Math.round(SAMPLE_RATE * seconds), SAMPLE_RATE);
  return createEngine({ context });
}

/** A mono buffer filled by a function of the sample index and its time in seconds. */
export function makeBuffer(
  seconds: number,
  fill: (index: number, time: number) => number,
): AudioBuffer {
  const length = Math.round(SAMPLE_RATE * seconds);
  const buffer = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: SAMPLE_RATE });
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = fill(i, i / SAMPLE_RATE);
  return buffer;
}

/** A buffer of ones: played through the graph it is a constant signal, which makes levels easy to read. */
export const ones = (seconds: number): AudioBuffer => makeBuffer(seconds, () => 1);

/** A single full-scale sample followed by silence. */
export const click = (): AudioBuffer => makeBuffer(0.01, (i) => (i === 0 ? 1 : 0));

/** The rendered value at a time, on channel 0. */
export function valueAt(buffer: AudioBuffer, seconds: number): number {
  return buffer.getChannelData(0)[Math.round(seconds * buffer.sampleRate)] ?? Number.NaN;
}

/**
 * Adds a constant signal of 1 to the engine as a sampler with the given id, already triggered at
 * time 0, and returns the chain so the test can continue it.
 */
export function constant(engine: Engine, seconds: number, id = 'dc') {
  const chain = engine.chain().sampler({ id, buffer: ones(seconds) });
  engine.select(`#${id}`).trigger({ at: 0 });
  return chain;
}
