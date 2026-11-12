/**
 * Live demo: a text box whose code is re-run on every key up.
 *
 * Every run goes through `build()` on one scope, which rebuilds in place: nodes the code still asks
 * for are kept and keep sounding, changed values are set on them, and what the code no longer asks for
 * is removed. If the code throws, `build()` undoes what it did and the previous run keeps playing, so a
 * half-typed line never interrupts the sound. Named sequences are replaced in place and stay in time.
 */

import { createEngine } from '../src';
import type { Engine } from '../src';
import * as util from '../src/util';
import { addSamples } from './samples';

const DEFAULT_CODE = `// Edit this code: it re-runs on every key up.
// While it has an error, the last working version keeps playing.

__.transport.bpm = 110;

// --- Drums, mixed on a bus of their own ---------------------------------------
// 'kick', 'snare' and 'hat' are sounds made by this page.
__.bus('drums');
__().sampler({ id: 'kick', buffer: 'kick' }).to('drums');
__().sampler({ id: 'snare', buffer: 'snare' }).gain(0.6).to('drums');
__().sampler({ id: 'hat', buffer: 'hat' }).highpass(6000).gain(0.35).to('drums');

// A pattern is a string or an array. Steps are sixteenth notes unless you say otherwise.
__.transport.sequence('kick', { steps: 'x..x..x...x..x..' }, (ev) => {
  if (ev.value) __('#kick').trigger();
});
__.transport.sequence('snare', { steps: [0, 1], step: '1/4' }, (ev) => {
  if (ev.value) __('#snare').trigger();
});
__.transport.sequence('hat', { steps: euclid(5, 8), step: '1/8', swing: 0.58 }, (ev) => {
  if (ev.value) __('#hat').trigger({ speed: 1 + ev.index * 0.04 });
});

// --- A recording that stays in time -------------------------------------------
// A recorder listening in on the drum bus. The bus goes on playing as normal.
__.bus('drums').chain().recorder({ id: 'tape', into: 'drum-bar' });

// A sampler that plays whatever was recorded last, at half speed.
__().sampler({ id: 'tape-play', buffer: 'drum-bar', speed: 0.5 })
  .lowpass(900).gain(0.7).to('main');

// Every four bars, record exactly one bar, starting on the bar line...
__.transport.every('4 bars', () => {
  __('#tape').trigger({ duration: __.transport.seconds('1 bar') });
});
// ...and two bars later, play it. At half speed one bar lasts two, so it ends on the bar.
__.transport.every('4 bars', () => __('#tape-play').trigger(), { offset: '2 bars' });

// --- A loop that stays in time ------------------------------------------------
// Anything sent to 'loop-in' can be looped. to(null) means this bus goes nowhere
// by itself: its only way out is through the looper, which passes the sound on.
__.bus('loop-in').to(null).chain().looper({ id: 'loop', length: '2 bars' }).to('main');

__().saw({ id: 'bass', gate: 'closed' })
  .lowpass({ id: 'filter', frequency: 500, q: 6 })
  .gain(0.25)
  .to('loop-in');
__().sine(0.2).gain(300).modulate('#filter', 'frequency');
__().sine({ id: 'blip', gate: 'closed', frequency: 880 }).gain(0.1).to('loop-in');

// The bass is only played in bars 1 and 2 of every eight, and the blips only in
// bars 3 and 4. The looper records each as a layer and keeps both going.
__.transport.sequence('bass', { steps: [55, 0, 55, 82.4, 0, 65.4, 0, 110], step: '1/8' }, (ev) => {
  if (ev.value && ev.bar % 8 < 2) {
    __('#bass').set({ frequency: ev.value }).trigger({ duration: ev.duration * 0.6 });
  }
});
__.transport.sequence('blips', { steps: 'x..x.x..', step: '1/8' }, (ev) => {
  if (ev.value && ev.bar % 8 >= 2 && ev.bar % 8 < 4) __('#blip').trigger({ duration: 0.04 });
});

// Bar 1: empty the looper and record two bars. Bar 3: record a second layer on top.
// Layers after the first are recorded a little quieter (the looper's 'overdub' level).
__.transport.every('8 bars', () => __('#loop').call('clear').trigger());
__.transport.every('8 bars', () => __('#loop').trigger(), { offset: '2 bars' });
`;

// The key carries a version. Bump it whenever the names available to demo code change, so code saved
// by an older version of the page (which may use names that no longer exist) is not loaded.
const STORAGE_KEY = 'cracked-up-demo-code-v4';
const OLD_STORAGE_KEYS = [
  'cracked-up-demo-code',
  'cracked-up-demo-code-v2',
  'cracked-up-demo-code-v3',
];

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
/** The code most recently attempted, so keys that do not change the text (arrows, shift) do nothing. */
let lastTried: string | null = null;

// --- Running the editor's code ----------------------------------------------------------------------

function showMessage(text: string, isError = false): void {
  message.textContent = text;
  message.classList.toggle('error', isError);
}

function describeError(error: unknown): string {
  // A failed build wraps what the code threw; the original says more (ReferenceError, TypeError).
  const original = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return original instanceof Error ? `${original.name}: ${original.message}` : String(original);
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

  const scope = target.scope('live');
  scope
    .build((api) => program(api, target, ...Object.values(helpers)))
    .then((result) => {
      if (result.errors[0]) return showMessage(describeError(result.errors[0]), true);
      const count = scope.select('*').length;
      const kept = result.unchanged.length + result.updated.length;
      showMessage(
        `Running. ${count} node${count === 1 ? '' : 's'}: ${kept} kept, ` +
          `${result.added.length} new, ${result.removed.length} removed.`,
      );
    })
    .catch((error: unknown) => showMessage(describeError(error), true));
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
