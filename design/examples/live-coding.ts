/**
 * Example 1: a live coder, using the global entry point.
 * Type-checked against the proposed API; nothing here runs yet.
 */

import { __, transport as t, euclid, play } from '../../src/global';

// Build three voices. Each chain owns its own tail, so the order of these lines does not matter.
__().sampler({ id: 'kick', buffer: '/samples/kick.wav' }).gain(0.9).to('main');
__()
  .sampler({ id: 'hat', buffer: '/samples/hat.wav', class: 'tops' })
  .highpass(6000)
  .gain(0.4)
  .to('main');
__()
  .saw({ id: 'bass', frequency: 55 })
  .lowpass({ id: 'bass-filter', frequency: 400, q: 8 })
  .adsr({ id: 'bass-env', attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 })
  .to('main');

// A slow filter sweep: the lfo connects to the filter's frequency parameter, not its input.
__().lfo({ frequency: 0.25, depth: 300 }).modulate('#bass-filter', 'frequency');

t.bpm = 128;

// Four on the floor. No `at` needed: inside a callback, operations default to the event's time.
t.steps('kick', 'x...x...x...x...', (_index, value) => {
  if (value) __('#kick').trigger();
});

// Five evenly spaced hats against the bar: a polyrhythm, phase-locked to the kick.
t.sequence('hats', { steps: 5, span: '1 bar' }, (ev) => {
  __('#hat').trigger({ speed: ev.index === 0 ? 1 : 1.5 });
});

// A swung euclidean bass line with a ratchet on the last step of each cycle.
t.sequence('bass', { steps: euclid(5, 8), step: '1/8', swing: 0.58, rests: false }, (ev) => {
  const notes = [55, 55, 82.4, 65.4, 110];
  __('#bass').set({ frequency: notes[ev.cycle % notes.length] ?? 55 });
  __('#bass-env').trigger({ duration: ev.duration * 0.5 });
  if (ev.index === ev.steps.length - 1) {
    __('#bass-env').trigger({ at: ev.at(0.5), duration: ev.duration * 0.25 });
  }
});

void play();

// Later, re-evaluating a block with the same name replaces that sequence in place, in phase:
t.steps('kick', 'x..x..x.x..x..x.', (_index, value) => {
  if (value) __('#kick').trigger();
});

// Selections are values. Holding one across callbacks is safe.
const tops = __('.tops');
t.every('4 bars', () => {
  tops.ramp('gain', 0, { duration: t.seconds('1 bar') });
});

// Every parameter has a shortcut setter.
__('#bass-filter').frequency(900).q(4);
__('sampler').speed(0.5);

// Nodes without an id can be picked by position.
__('gain:nth(0)').gain(0.7);

// A pattern is an array of numbers or a string: 'x' is 1 and '.' is 0, so these two are the same.
t.sequence('clap', { steps: [0, 0, 1, 0], step: '1/8' }, (ev) => {
  if (ev.value) __('#hat').trigger({ speed: 0.5 });
});
t.sequence('clap', { steps: '..x.', step: '1/8' }, (ev) => {
  if (ev.value) __('#hat').trigger({ speed: 0.5 });
});

// Remove one sequence by name, or keep the handle and stop it.
const shaker = t.sequence('shaker', { steps: 7, span: '1 bar' }, () => {});
shaker.stop();
t.clear('clap');
