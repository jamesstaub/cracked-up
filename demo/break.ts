/**
 * The drum break the demos offer under the buffer key 'break'.
 *
 * The audio is not in this repository. The page fetches Freesound's public preview of the sound when
 * audio starts, and everything else works if that request fails.
 */

import type { BufferRef, Engine } from '../src';

export const BREAK = {
  /** The name samplers use: `sampler({ buffer: 'break' })`. */
  key: 'break',
  name: 'Crunchy Drum Break 2 [128bpm]',
  author: 'deadrobotmusic',
  licence: 'Creative Commons 0',
  licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  page: 'https://freesound.org/people/deadrobotmusic/sounds/629052/',
  /** Freesound's public preview. It needs no login and allows requests from any page. */
  url: 'https://cdn.freesound.org/previews/629/629052_11532701-hq.mp3',
  /**
   * Measured from the decoded audio: 15.000 seconds, first hit at 0, and the drum hits sit on a
   * sixteenth-note grid at 128 bpm from start to end. That is 8 bars of 4 beats, cut exactly to the bar.
   */
  bpm: 128,
  bars: 8,
  beatsPerBar: 4,
} as const;

/** How many slices the demos cut the break into: one per sixteenth note. */
export const BREAK_SLICES = BREAK.bars * BREAK.beatsPerBar * 4;

/** How long the break lasts at its own tempo, in seconds. */
export const BREAK_SECONDS = (BREAK.bars * BREAK.beatsPerBar * 60) / BREAK.bpm;

/**
 * Slice boundaries for a sound cut into equal parts: `count` slices need `count + 1` boundaries, in
 * seconds. `offset` moves the whole grid later, for a sound whose first hit is not at its start.
 */
export function sliceGrid(seconds: number, count: number, offset = 0): number[] {
  const slices = Math.max(1, Math.floor(count));
  return Array.from({ length: slices + 1 }, (_, index) => offset + (seconds * index) / slices);
}

/** One line saying whose sound the break is. */
export const BREAK_CREDIT = `${BREAK.name} by ${BREAK.author}, ${BREAK.licence}`;

/**
 * Starts loading the break and cuts it into sixteenth notes. It does not wait: a sampler that uses
 * 'break' is silent until the audio arrives. `onError` is called if it never does.
 */
export function loadBreak(engine: Engine, onError: (message: string) => void): BufferRef {
  engine.buffers.on('error', (failed) => {
    if (failed.key !== BREAK.key) return;
    onError(
      `The drum break could not be loaded from Freesound (${failed.error?.cause instanceof Error ? failed.error.cause.message : 'no connection'}). ` +
        `Samplers that play 'break' are silent. Everything else works.`,
    );
  });
  const ref = engine.buffers.load(BREAK.url, { key: BREAK.key });
  // The grid comes from the tempo, not from the file, so it can be set before the audio is here.
  ref.slices = sliceGrid(BREAK_SECONDS, BREAK_SLICES);
  return ref;
}
