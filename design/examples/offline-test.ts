/**
 * Example 3: rendering offline, as the library's own tests and a host's export will.
 */

import { createEngine } from '../not-yet-implemented';

declare const findOnsets: (
  buffer: AudioBuffer,
  options: { threshold: number; minGapSamples: number },
) => number[];
declare const expectEqual: (actual: unknown, expected: unknown) => void;

/** Three against four over one bar at 120 bpm: onsets must land on exact samples. */
export async function polyrhythmLandsOnTheSample(): Promise<void> {
  const sampleRate = 48000;
  const barSeconds = 2; // 4 beats at 120 bpm
  const engine = await createEngine({
    context: new OfflineAudioContext(1, sampleRate * barSeconds, sampleRate),
    seed: 1,
  });

  engine
    .chain()
    .sine({ id: 'blip', frequency: 1000 })
    .adsr({ id: 'env', attack: 0, decay: 0.01, sustain: 0, release: 0 })
    .to('main');

  const t = engine.transport;
  t.bpm = 120;
  t.sequence({ steps: 3, span: '1 bar' }, () => {
    engine.select('#env').trigger();
  });
  t.start();

  const audio = await engine.render();

  const onsets = findOnsets(audio, { threshold: 0.01, minGapSamples: 480 });
  expectEqual(onsets, [0, 32000, 64000]);

  engine.dispose();
}

/** Two engines side by side: nothing is shared, so a test never leaks into the next. */
export async function enginesAreIndependent(): Promise<void> {
  const a = await createEngine({ context: new OfflineAudioContext(1, 4800, 48000) });
  const b = await createEngine({ context: new OfflineAudioContext(1, 4800, 48000) });
  a.chain().sine({ id: 'tone' }).to('main');
  expectEqual(a.select('#tone').length, 1);
  expectEqual(b.select('#tone').length, 0);
}
