/**
 * Live demo: an editor whose code is re-run on every change.
 *
 * Every run goes through `build()` on one scope, which rebuilds in place: nodes the code still asks
 * for are kept and keep sounding, changed values are set on them, and what the code no longer asks for
 * is removed. If the code throws, `build()` undoes what it did and the previous run keeps playing, so a
 * half-typed line never interrupts the sound. Named sequences are replaced in place and stay in time.
 */

import { createEngine } from '../src';
import type { Engine, NodeTypeInfo } from '../src';
import { catalogFromEngine, createCatalogStore, createEditor } from '../src/editor';
import type { EditorCatalog } from '../src/editor';
import { HELPER_GROUPS, helpers, wrapUserCode } from './helpers';
import { BREAK, BREAK_CREDIT, loadBreak } from './break';
import { DEMO_BUFFERS, builtinTypes } from './catalog';
import { addSamples } from './samples';

const DEFAULT_CODE = `// Edit this code: it re-runs as you type.
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

const toggle = document.querySelector<HTMLButtonElement>('#toggle')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
const status = document.querySelector<HTMLSpanElement>('#status')!;
const message = document.querySelector<HTMLDivElement>('#message')!;

// The names user code can use besides `__` and `engine` are `helpers`, shared with the sandboxed demo.

let engine: Engine | null = null;
let booting: Promise<Engine> | null = null;
/** The code most recently attempted, so keys that do not change the text (arrows, shift) do nothing. */
let lastTried: string | null = null;

// --- Running the editor's code ----------------------------------------------------------------------

/** The latest message about the code, and a note that stays whatever the code does. */
let said = { text: '', isError: false };
let notice = '';

function renderMessage(): void {
  message.textContent = [said.text, notice].filter(Boolean).join('\n');
  message.classList.toggle('error', said.isError);
}

function showMessage(text: string, isError = false): void {
  said = { text, isError };
  renderMessage();
}

/** Shows a lasting note under the message, such as a sample that could not be loaded. */
function showNotice(text: string): void {
  notice = text;
  renderMessage();
}

function describeError(error: unknown): string {
  // A failed build wraps what the code threw; the original says more (ReferenceError, TypeError).
  const original = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return original instanceof Error ? `${original.name}: ${original.message}` : String(original);
}

/** Shows a failure in the footer and, when the editor can tell where it is, on its line. */
function showError(error: unknown): void {
  showMessage(describeError(error), true);
  const original = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  editor.showError(original);
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
    program = new Function('__', 'engine', ...Object.keys(helpers), wrapUserCode(code)) as (
      ...args: unknown[]
    ) => void;
  } catch (error) {
    showError(error);
    return;
  }

  const scope = target.scope('live');
  scope
    .build((api) => program(api, target, ...Object.values(helpers)))
    .then((result) => {
      // Something later may have been typed since; its own run reports on it.
      if (code !== lastTried) return;
      if (result.errors[0]) return showError(result.errors[0]);
      editor.clearError();
      const count = scope.select('*').length;
      const kept = result.unchanged.length + result.updated.length;
      showMessage(
        `Running. ${count} node${count === 1 ? '' : 's'}: ${kept} kept, ` +
          `${result.added.length} new, ${result.removed.length} removed.`,
      );
    })
    .catch((error: unknown) => showError(error));
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
    created.on('error', showError);
    created.on('state', updateStatus);
    addSamples(created);
    // Not awaited: the break arrives when it arrives, and a sampler without audio is silent.
    loadBreak(created, (problem) => {
      showNotice(problem);
      document.querySelector('#break-sample')?.classList.add('missing');
    });
    fillReference(created.registry.list());
    // From here the editor completes from the live engine: its types, and buffers as they load.
    const refresh = (): void => catalog.set(catalogFor(created));
    created.buffers.on('ready', refresh);
    refresh();
    engine = created;
    // For poking at the engine from the browser's console: `engine.buffers.get('break').duration`.
    Object.assign(window, { engine: created });
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

/** Makes a list item put text into the editor when it is clicked. */
function insertOnClick(item: HTMLElement, text: string): void {
  item.classList.add('insert');
  item.addEventListener('click', (event) => {
    // A link inside the item (the break's credit) is followed, not inserted.
    if ((event.target as HTMLElement).closest('a')) return;
    editor.insert(text);
    editor.focus();
  });
}

/** Rows of [name, detail, the text a click inserts]. */
function fillList(id: string, rows: readonly (readonly [string, string, string?])[]): void {
  const list = document.querySelector<HTMLUListElement>(`#${id}`)!;
  list.replaceChildren(
    ...rows.map(([name, detail, insert]) => {
      const item = document.createElement('li');
      const extra = document.createElement('span');
      extra.textContent = detail ? ` ${detail}` : '';
      item.append(name, extra);
      if (insert) insertOnClick(item, insert);
      return item;
    }),
  );
}

/** The sample names need no engine, so they and the break's credit are there before audio starts. */
function fillSamples(): void {
  fillList('samples', [
    ["'kick'", '', "'kick'"],
    ["'snare'", '', "'snare'"],
    ["'hat'", '', "'hat'"],
  ]);
  const item = document.createElement('li');
  item.id = 'break-sample';
  const credit = document.createElement('a');
  credit.href = BREAK.page;
  credit.target = '_blank';
  credit.rel = 'noopener';
  credit.textContent = BREAK_CREDIT;
  const detail = document.createElement('span');
  detail.append(' a drum break in 128 slices. ', credit);
  item.append(`'${BREAK.key}'`, detail);
  insertOnClick(item, `'${BREAK.key}'`);
  document.querySelector<HTMLUListElement>('#samples')!.append(item);
}

function fillReference(types: readonly NodeTypeInfo[]): void {
  // Straight from the library's own metadata, so it cannot go out of date.
  fillList(
    'types',
    types.map((info) => [
      info.type,
      info.params.map((param) => param.name).join(', '),
      `${info.type}()`,
    ]),
  );
}

/**
 * The helper list needs no engine, so it is there before audio starts. Each helper is shown as its
 * call, in a group; what it does is in the tooltip and in the docs.
 */
function fillHelpers(): void {
  fillList('helpers', [
    ['__()', 'start a chain'],
    ["__('selector')", 'select nodes'],
    ['__.transport.sequence(name, options, fn)', 'a repeating pattern'],
    ['__.transport.every(interval, fn)', 'a repeating callback'],
    ['__.transport.bpm', 'tempo'],
  ]);
  const groups = document.querySelector<HTMLDivElement>('#helper-groups')!;
  groups.replaceChildren(
    ...HELPER_GROUPS.flatMap((group) => {
      const heading = document.createElement('h3');
      heading.textContent = group.title;
      const list = document.createElement('ul');
      list.append(
        ...group.helpers.map((doc) => {
          const item = document.createElement('li');
          item.textContent = doc.signature;
          insertOnClick(item, `${doc.name}()`);
          item.title = doc.alias
            ? `${doc.description} Also as ${doc.alias}, its name in Cracked.`
            : doc.description;
          return item;
        }),
      );
      return [heading, list];
    }),
  );
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

// --- The editor --------------------------------------------------------------------------------------

/** What the editor is told about an engine: its types and buffers, and the names this page adds. */
function catalogFor(target: Engine | null): EditorCatalog {
  const extra: EditorCatalog = {
    globals: [
      {
        name: 'engine',
        description: 'The engine this page made: engine.buffers, engine.registry.',
      },
    ],
  };
  if (!target) return { buffers: DEMO_BUFFERS, ...extra };
  const loaded = catalogFromEngine(target, extra);
  // Sounds still loading are offered by name too.
  const known = new Set(
    (loaded.buffers ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.key)),
  );
  return {
    ...loaded,
    buffers: [...(loaded.buffers ?? []), ...DEMO_BUFFERS.filter((entry) => !known.has(entry.key))],
  };
}

const catalog = createCatalogStore(catalogFor(null));
// The node types are known before audio starts, from an engine that makes no sound.
void builtinTypes().then((types) => {
  if (engine) return;
  catalog.update({ types });
  fillReference(types);
});

const editor = createEditor({
  parent: document.querySelector<HTMLDivElement>('#editor')!,
  doc: initialCode(),
  catalog,
  // The footer shows the message; the editor only marks the line.
  errorPanel: false,
  onChange: () => {
    if (engine) run(engine);
    else void start();
  },
});
// For poking at the editor from the browser's console: `editor.value`.
Object.assign(window, { editor });

fillSamples();
fillHelpers();

/** Puts code from outside (Reset, a docs example) in the editor and runs it. */
function load(code: string): void {
  editor.setValue(code);
  lastTried = null;
  if (engine) run(engine);
}

toggle.addEventListener('click', () => {
  void (engine?.context.state === 'running' ? stopAudio() : start());
});

reset.addEventListener('click', () => {
  load(DEFAULT_CODE);
  editor.focus();
});

// Opening another example from the docs while this page is already open only changes the address.
window.addEventListener('hashchange', () => {
  const code = codeFromAddress();
  if (code !== null) load(code);
});

updateStatus();
