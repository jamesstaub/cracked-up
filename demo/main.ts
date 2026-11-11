/**
 * Live demo: a text box whose code is re-run on every key up.
 *
 * Each run builds into a fresh scope. If the code compiles and runs, the previous scope is disposed;
 * if it fails, the new scope is thrown away and the previous one keeps sounding, so a half-typed line
 * never interrupts the sound.
 */

import { createEngine } from '../src';
import type { Engine, Scope } from '../src';
import * as util from '../src/util';

const DEFAULT_CODE = `// Edit this code: it re-runs on every key up.
// While it has an error, the last working version keeps playing.

// A droning bass through a filter.
__().saw({ id: 'bass', frequency: 55 })
  .lowpass({ id: 'filter', frequency: 400, q: 8 })
  .gain(0.3)
  .to('main');

// A slow sine wave moving the filter's cutoff by +/- 300 Hz.
__().sine(0.2).gain(300).modulate('#filter', 'frequency');

// Two samplers. 'kick', 'snare' and 'hat' are made by this page.
__().sampler({ id: 'kick', buffer: 'kick' }).to('main');
__().sampler({ id: 'hat', buffer: 'hat' }).highpass(6000).gain(0.4).to('main');

// The transport is not built yet. \`every\` is a temporary stand-in
// (a plain timer, so its timing is loose).
const kick = euclid(3, 8);
let step = 0;
every(0.125, () => {
  if (kick[step % kick.length]) __('#kick').trigger();
  __('#hat').trigger({ speed: 1 + (step % 3) * 0.25 });
  step++;
});
`;

const STORAGE_KEY = 'cracked-up-demo-code';

const editor = document.querySelector<HTMLTextAreaElement>('#editor')!;
const toggle = document.querySelector<HTMLButtonElement>('#toggle')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
const status = document.querySelector<HTMLSpanElement>('#status')!;
const message = document.querySelector<HTMLDivElement>('#message')!;

/** The names user code can use besides `__`, `engine` and `every`. */
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
let liveTimers: number[] = [];
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
    program = new Function(
      '__',
      'engine',
      'every',
      ...Object.keys(helpers),
      `"use strict";\n${code}`,
    ) as (...args: unknown[]) => void;
  } catch (error) {
    showMessage(describeError(error), true);
    return;
  }

  const scope = target.scope(`live-${++generation}`);
  const timers: number[] = [];
  const every = (seconds: number, callback: () => void): void => {
    if (!(seconds > 0)) throw new RangeError('every() needs a number of seconds above 0');
    timers.push(
      window.setInterval(
        () => {
          try {
            callback();
          } catch (error) {
            showMessage(describeError(error), true);
          }
        },
        Math.max(seconds * 1000, 10),
      ),
    );
  };

  try {
    program(scope.$, target, every, ...Object.values(helpers));
  } catch (error) {
    // Runtime error: discard what this run built and leave the previous run sounding.
    timers.forEach((id) => window.clearInterval(id));
    scope.dispose();
    showMessage(describeError(error), true);
    return;
  }

  // Success: swap. The old scope goes only now, so there is no gap while typing.
  liveTimers.forEach((id) => window.clearInterval(id));
  liveScope?.dispose();
  liveScope = scope;
  liveTimers = timers;
  const count = scope.select('*').length;
  showMessage(`Running. ${count} node${count === 1 ? '' : 's'}.`);
}

// --- Starting and stopping audio --------------------------------------------------------------------

function updateStatus(): void {
  const running = engine?.context.state === 'running';
  status.textContent = running
    ? 'Audio is on.'
    : engine
      ? 'Audio is paused.'
      : 'Audio is off. Press Start, or just type.';
  status.classList.toggle('running', running);
  toggle.textContent = running ? 'Stop audio' : 'Start audio';
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
    return created;
  })();
  return booting;
}

async function start(): Promise<void> {
  const target = await boot();
  await target.resume();
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
    ['every(seconds, fn)', 'temporary timer'],
    ...Object.keys(helpers).map((name) => [name, ''] as const),
  ]);
}

// --- Wiring -----------------------------------------------------------------------------------------

function initialCode(): string {
  try {
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

updateStatus();
