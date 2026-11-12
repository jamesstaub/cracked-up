/**
 * Sandboxed script demo: the page owns the engine, a sandboxed frame runs the code.
 *
 *   textarea --code--> frame: remote.build(code) --commands--> page: link -> scope
 *                      frame: sequence callbacks <--events---- page: transport
 */

import { createEngine } from '../src';
import type { Engine } from '../src';
import { linkRemote } from '../src/remote';
import type { Link } from '../src/remote';
import { BREAK, BREAK_CREDIT, loadBreak } from './break';
import { attachHighlighter } from './highlight';
import { addSamples } from './samples';
import type { FromFrame, ToFrame } from './sandbox-protocol';

const DEFAULT_CODE = `// This code runs in a sandboxed frame, not in the page.
// It has no audio and cannot reach the page: it sends commands.

__.transport.bpm = 110;

__().sampler({ id: 'kick', buffer: 'kick' }).to('main');
__().sampler({ id: 'hat', buffer: 'hat' }).highpass(6000).gain(0.35).to('main');

__().saw({ id: 'bass', gate: 'closed' })
  .lowpass({ id: 'filter', frequency: 500, q: 6 })
  .gain(0.25)
  .to('main');

// The callbacks run in the frame, a little ahead of time.
__.transport.sequence('kick', { steps: 'x..x..x...x..x..' }, (ev) => {
  if (ev.value) __('#kick').trigger();
});

__.transport.sequence('hat', { steps: euclid(5, 8), step: '1/8' }, (ev) => {
  if (ev.value) __('#hat').trigger({ speed: 1 + ev.index * 0.04 });
});

__.transport.sequence('bass', { steps: [55, 0, 55, 82.4, 0, 65.4, 0, 110], step: '1/8' }, (ev) => {
  if (ev.value) {
    __('#bass').set({ frequency: ev.value }).trigger({ duration: ev.duration * 0.6 });
  }
});

// A node type of your own, defined right here in the sandbox. Its inner graph is sent to the
// page as data; its trigger() runs here each time the page asks.
define({
  type: 'blip',
  params: {
    pitch: { default: 660, min: 50, max: 4000, drives: [{ select: '#tone', param: 'frequency' }] },
  },
  build(__) {
    __().sine({ id: 'tone', gate: 'closed' }).gain(0.15).to('out');
  },
  trigger(__, options) {
    __('#tone').trigger({ duration: options.duration ?? 0.05 });
  },
});
__().blip({ id: 'blip' }).to('main');

__.transport.every('1/4', (ev) => {
  __('#blip').set({ pitch: ev.beat % 4 === 0 ? 1320 : 660 }).trigger();
}, { offset: '1/8' });

// Things a script might try. Each fails or finds nothing:
// document.cookie; localStorage.getItem('x'); parent.document.title;
`;

const editor = document.querySelector<HTMLTextAreaElement>('#editor')!;
const toggle = document.querySelector<HTMLButtonElement>('#toggle')!;
const status = document.querySelector<HTMLSpanElement>('#status')!;
const message = document.querySelector<HTMLDivElement>('#message')!;
const timing = document.querySelector<HTMLUListElement>('#timing')!;
const frame = document.querySelector<HTMLIFrameElement>('#frame')!;

let engine: Engine | null = null;
let link: Link | null = null;
let booting: Promise<void> | null = null;
let lastSent: string | null = null;

/** The latest result from the frame, and a note that stays whatever the code does. */
let said: { text: string; isError: boolean } = { text: '', isError: false };
let notice = '';

function showMessage(text: string, isError: boolean): void {
  said = { text, isError };
  message.textContent = [said.text, notice].filter(Boolean).join('\n');
  message.classList.toggle('error', isError);
}

// --- Round-trip timing --------------------------------------------------------------------------------

/** When each sequence event was posted to the frame, by event time, until its commands come back. */
const posted = new Map<number, number>();
const trips: number[] = [];
let lateCommands = 0;

function noteReturn(times: readonly number[]): void {
  for (const time of new Set(times)) {
    const sentAt = posted.get(time);
    if (sentAt === undefined) continue;
    posted.delete(time);
    trips.push(performance.now() - sentAt);
    if (trips.length > 200) trips.shift();
    if (engine && time < engine.context.currentTime) lateCommands++;
  }
}

function showTiming(): void {
  if (trips.length === 0 || !engine) return;
  const sorted = [...trips].sort((a, b) => a - b);
  const mean = trips.reduce((sum, value) => sum + value, 0) / trips.length;
  const rows = [
    `mean ${mean.toFixed(2)} ms`,
    `worst ${sorted[sorted.length - 1]!.toFixed(2)} ms (last ${trips.length} steps)`,
    `look-ahead ${(engine.transport.lookahead * 1000).toFixed(0)} ms`,
    `commands that came back too late: ${lateCommands}`,
  ];
  timing.replaceChildren(
    ...rows.map((text) => Object.assign(document.createElement('li'), { textContent: text })),
  );
}

// --- Talking to the frame -----------------------------------------------------------------------------

const frameReady = new Promise<void>((resolve) => {
  window.addEventListener('message', (event: MessageEvent<FromFrame>) => {
    // The frame has no origin to check, so check that the message came from its window.
    if (event.source !== frame.contentWindow) return;
    const data = event.data;
    if (data.kind === 'ready') resolve();
    else if (data.kind === 'remote') {
      if (data.message.type === 'commands') {
        noteReturn(data.message.commands.flatMap((c) => ('at' in c && c.at > 0 ? [c.at] : [])));
      }
      link?.receive(data.message);
    } else if (data.kind === 'result') {
      showMessage(
        data.error ?? `Running in the sandbox. ${data.nodes} node${data.nodes === 1 ? '' : 's'}.`,
        data.error !== null,
      );
    }
  });
});

// Load the frame only now that the listener above exists, so its "ready" cannot be missed.
frame.src = './sandbox-frame.html';

// '*' because a sandboxed frame's origin is opaque and cannot be named.
const toFrame = (data: ToFrame): void => frame.contentWindow?.postMessage(data, '*');

function sendCode(): void {
  if (!link || editor.value === lastSent) return;
  lastSent = editor.value;
  toFrame({ kind: 'run', code: lastSent });
}

// --- Audio --------------------------------------------------------------------------------------------

function updateStatus(): void {
  const running = engine?.context.state === 'running';
  status.textContent = running ? `${engine!.transport.bpm} bpm` : 'Audio is off.';
  status.classList.toggle('running', running);
  toggle.textContent = running ? 'Stop audio' : 'Start audio';
}

function boot(): Promise<void> {
  booting ??= (async () => {
    const created = await createEngine({ context: new AudioContext() });
    created.bus('main').gain.set(0.6);
    created.on('error', (error) => showMessage(error.message, true));
    created.on('state', updateStatus);
    created.transport.on('tempo', updateStatus);
    addSamples(created);
    // The page loads the break; the script may not fetch anything. It is cut into slices here, before
    // the link exists, so the frame is told about the slices along with the audio's length.
    loadBreak(created, (problem) => {
      notice = problem;
      showMessage(said.text, said.isError);
    });
    await frameReady;
    link = linkRemote(created.scope('sandboxed'), {
      send: (hostMessage) => {
        if (hostMessage.type === 'event') posted.set(hostMessage.event.time, performance.now());
        toFrame({ kind: 'host', message: hostMessage });
      },
      // A script may set the tempo here, but may not make the engine fetch URLs.
      allow: (command) => command.op !== 'loadBuffer',
    });
    toFrame({ kind: 'init', state: link.state() });
    engine = created;
    // For looking at the page's engine from the browser's console. The frame cannot reach it.
    Object.assign(window, { engine: created });
    setInterval(showTiming, 500);
  })();
  return booting;
}

async function start(): Promise<void> {
  await boot();
  await engine!.resume();
  engine!.transport.start();
  updateStatus();
  sendCode();
}

editor.value = DEFAULT_CODE;
attachHighlighter(editor, document.querySelector<HTMLPreElement>('#highlight')!);

const credit = document.querySelector<HTMLAnchorElement>('#break-credit')!;
credit.href = BREAK.page;
credit.textContent = BREAK_CREDIT;
editor.addEventListener('keyup', () => {
  if (engine) sendCode();
  else void start();
});
toggle.addEventListener('click', () => {
  if (engine?.context.state === 'running') {
    void (engine.context as AudioContext).suspend().then(updateStatus);
  } else void start();
});
updateStatus();
