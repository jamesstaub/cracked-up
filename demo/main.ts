/**
 * Live demo: a text box whose code is re-run on every key up.
 *
 * Each run gets its own scope: `__` builds nodes in it, and `__.transport` schedules sequences that
 * belong to it. If the code compiles and runs, the previous run's scope is disposed, which removes its
 * nodes and sequences; if it fails, the new scope is disposed instead and the previous run keeps
 * playing, so a half-typed line never interrupts the sound. Sequences take their place from the
 * transport's position, so a new run comes in exactly in time with the old one.
 */

import { createEngine } from '../src';
import type { Engine, Scope } from '../src';
import * as util from '../src/util';

const DEFAULT_CODE = `// Edit this code: it re-runs on every key up.
// While it has an error, the last working version keeps playing.

__.transport.bpm = 110;

// Three samplers. 'kick', 'snare' and 'hat' are made by this page.
__().sampler({ id: 'kick', buffer: 'kick' }).to('main');
__().sampler({ id: 'snare', buffer: 'snare' }).gain(0.6).to('main');
__().sampler({ id: 'hat', buffer: 'hat' }).highpass(6000).gain(0.35).to('main');

// A pattern is a string or an array. Steps are sixteenth notes unless you say otherwise.
__.transport.sequence('kick', { steps: 'x..x..x...x..x..' }, (ev) => {
  if (ev.value) __('#kick').trigger();
});

// Quarter-note steps: the snare lands on beats 2 and 4.
__.transport.sequence('snare', { steps: [0, 1], step: '1/4' }, (ev) => {
  if (ev.value) __('#snare').trigger();
});

// Five hits spread evenly over eight swung eighth notes.
__.transport.sequence('hat', { steps: euclid(5, 8), step: '1/8', swing: 0.58 }, (ev) => {
  if (ev.value) __('#hat').trigger({ speed: 1 + ev.index * 0.04 });
});

// A bass: an oscillator that is silent until triggered, through a filter.
__().saw({ id: 'bass', gate: 'closed' })
  .lowpass({ id: 'filter', frequency: 500, q: 6 })
  .gain(0.25)
  .to('main');

// A slow sine wave moving the filter's cutoff by +/- 300 Hz.
__().sine(0.2).gain(300).modulate('#filter', 'frequency');

// Step values can be any number. Here each one is a pitch in Hz, and 0 is a rest.
__.transport.sequence('bass', { steps: [55, 0, 55, 82.4, 0, 65.4, 0, 110], step: '1/8' }, (ev) => {
  if (ev.value) {
    __('#bass').set({ frequency: ev.value }).trigger({ duration: ev.duration * 0.6 });
  }
});
`;

// The key carries a version. Bump it whenever the names available to demo code change, so code saved
// by an older version of the page (which may use names that no longer exist) is not loaded.
const STORAGE_KEY = 'cracked-up-demo-code-v3';
const OLD_STORAGE_KEYS = ['cracked-up-demo-code', 'cracked-up-demo-code-v2'];

const editor = document.querySelector<HTMLTextAreaElement>('#editor')!;
const toggle = document.querySelector<HTMLButtonElement>('#toggle')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
const status = document.querySelector<HTMLSpanElement>('#status')!;
const message = document.querySelector<HTMLDivElement>('#message')!;

/** The names user code can use besides `__` and `engine`. */
const helpers = {
  euclid: util.euclid,
  pitchToFreq: util.pitchToFreq,
  freqToPitch: util.freqToPitch,
  scales: util.scales,
  chords: util.chords,
  dbToGain: util.dbToGain,
};

let engine: Engine | null = null;
let booting: Promise<Engine> | null = null;
let liveScope: Scope | null = null;
let generation = 0;
/** The code most recently attempted, so keys that do not change the text (arrows, shift) do nothing. */
let lastTried: string | null = null;

// --- Samples made in code, so the demo needs no audio files ----------------------------------------

function makeSample(
  context: BaseAudioContext,
  seconds: number,
  fill: (time: number, random: () => number) => number,
): AudioBuffer {
  const length = Math.round(context.sampleRate * seconds);
  const buffer = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: context.sampleRate });
  const data = buffer.getChannelData(0);
  const random = util.createRandom(1);
  for (let i = 0; i < length; i++)
    data[i] = fill(i / context.sampleRate, () => random.float() * 2 - 1);
  return buffer;
}

function addSamples(target: Engine): void {
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

// --- Running the editor's code ----------------------------------------------------------------------

function showMessage(text: string, isError = false): void {
  message.textContent = text;
  message.classList.toggle('error', isError);
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function run(target: Engine): void {
  const code = editor.value;
  if (code === lastTried) return;
  lastTried = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage can be unavailable (private windows); the demo works without it.
  }

  // Compile first. A syntax error touches nothing.
  let program: (...args: unknown[]) => void;
  try {
    program = new Function('__', 'engine', ...Object.keys(helpers), `"use strict";\n${code}`) as (
      ...args: unknown[]
    ) => void;
  } catch (error) {
    showMessage(describeError(error), true);
    return;
  }

  const scope = target.scope(`live-${++generation}`);

  try {
    program(scope.$, target, ...Object.values(helpers));
  } catch (error) {
    // Runtime error: discard what this run built and leave the previous run playing. Disposing the
    // scope removes its nodes and whatever it scheduled through `__.transport`.
    scope.dispose();
    showMessage(describeError(error), true);
    return;
  }

  // Success: swap. The old run goes only now, so there is no gap while typing.
  liveScope?.dispose();
  liveScope = scope;
  const count = scope.select('*').length;
  showMessage(`Running. ${count} node${count === 1 ? '' : 's'}.`);
}

// --- Starting and stopping audio --------------------------------------------------------------------

function updateStatus(): void {
  const running = engine?.context.state === 'running';
  status.textContent = running
    ? positionText()
    : engine
      ? 'Audio is paused.'
      : 'Audio is off. Press Start, or just type.';
  status.classList.toggle('running', running);
  toggle.textContent = running ? 'Stop audio' : 'Start audio';
}

/** Tempo and where the transport is, as bar and beat counted from 1. */
function positionText(): string {
  if (!engine) return '';
  const { bar, beatInBar } = engine.transport.position;
  return `${engine.transport.bpm} bpm · bar ${bar + 1} beat ${Math.floor(beatInBar) + 1}`;
}

/** Keeps the position readout moving while audio runs. */
function watchPosition(): void {
  if (engine?.context.state === 'running') status.textContent = positionText();
  requestAnimationFrame(watchPosition);
}

/** Creates the engine on the first user gesture (browsers do not allow sound before one). */
function boot(): Promise<Engine> {
  booting ??= (async () => {
    const context = new AudioContext();
    const created = await createEngine({ context });
    created.bus('main').gain.set(0.6);
    created.on('error', (error) => showMessage(describeError(error), true));
    created.on('state', updateStatus);
    addSamples(created);
    fillReference(created);
    engine = created;
    watchPosition();
    return created;
  })();
  return booting;
}

async function start(): Promise<void> {
  const target = await boot();
  await target.resume();
  target.transport.start();
  updateStatus();
  run(target);
}

async function stopAudio(): Promise<void> {
  if (engine) await (engine.context as AudioContext).suspend();
  updateStatus();
}

// --- The reference column ---------------------------------------------------------------------------

function fillList(id: string, rows: readonly (readonly [string, string])[]): void {
  const list = document.querySelector<HTMLUListElement>(`#${id}`)!;
  list.replaceChildren(
    ...rows.map(([name, detail]) => {
      const item = document.createElement('li');
      const extra = document.createElement('span');
      extra.textContent = detail ? ` ${detail}` : '';
      item.append(name, extra);
      return item;
    }),
  );
}

function fillReference(target: Engine): void {
  fillList('samples', [
    ["'kick'", ''],
    ["'snare'", ''],
    ["'hat'", ''],
  ]);
  // Straight from the library's own metadata, so it cannot go out of date.
  fillList(
    'types',
    target.registry
      .list()
      .map((info) => [info.type, info.params.map((param) => param.name).join(', ')]),
  );
  fillList('helpers', [
    ['__()', 'start a chain'],
    ["__('selector')", 'select nodes'],
    ['__.transport.sequence(name, options, fn)', 'a repeating pattern'],
    ['__.transport.every(interval, fn)', 'a repeating callback'],
    ['__.transport.bpm', 'tempo'],
    ...Object.keys(helpers).map((name) => [name, ''] as const),
  ]);
}

// --- Wiring -----------------------------------------------------------------------------------------

/** Code passed in the address as `#code=...`, which is how the docs page opens an example here. */
function codeFromAddress(): string | null {
  const match = /^#code=(.*)$/s.exec(location.hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1] ?? '');
  } catch {
    return null;
  }
}

function initialCode(): string {
  const fromAddress = codeFromAddress();
  if (fromAddress !== null) return fromAddress;
  try {
    for (const key of OLD_STORAGE_KEYS) localStorage.removeItem(key);
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_CODE;
  } catch {
    return DEFAULT_CODE;
  }
}

editor.value = initialCode();

editor.addEventListener('keyup', () => {
  if (engine) run(engine);
  else void start();
});

// Tab indents instead of leaving the editor.
editor.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey) return;
  event.preventDefault();
  editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
});

toggle.addEventListener('click', () => {
  void (engine?.context.state === 'running' ? stopAudio() : start());
});

reset.addEventListener('click', () => {
  editor.value = DEFAULT_CODE;
  lastTried = null;
  if (engine) run(engine);
  editor.focus();
});

// Opening another example from the docs while this page is already open only changes the address.
window.addEventListener('hashchange', () => {
  const code = codeFromAddress();
  if (code === null) return;
  editor.value = code;
  if (engine) run(engine);
});

updateStatus();
