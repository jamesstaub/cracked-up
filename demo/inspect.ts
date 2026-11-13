/**
 * A page for the graph inspector: one moderately busy patch, a Start button, and the inspector
 * beside it.
 *
 * Address options, for trying things out and for measuring:
 *   ?side=1      the inspector at sidebar width (420 px) instead of filling the page
 *   ?stress=80   adds that many extra chains (three nodes each), to see what a large graph costs
 */

import { createEngine } from '../src';
import type { Engine, ScopeApi } from '../src';
import { createInspector, openInspector } from '../src/inspect';
import type { Inspector } from '../src/inspect';
import { addSamples } from './samples';

const query = new URLSearchParams(location.search);
const stress = Math.max(0, Math.min(400, Number(query.get('stress')) || 0));
if (query.has('side')) document.body.classList.add('narrow');

let extraVoice = false;
let driveOn = false;

/** The patch. `build()` runs this every time something on the page changes it. */
function patch(__: ScopeApi): void {
  __.transport.bpm = 104;

  // Drums, mixed on a bus of their own.
  __.bus('drums');
  __().sampler({ id: 'kick', buffer: 'kick' }).to('drums');
  __().sampler({ id: 'snare', buffer: 'snare' }).gain(0.6).to('drums');
  __().sampler({ id: 'hat', buffer: 'hat' }).highpass(6000).gain(0.35).to('drums');

  // A bass through a filter an lfo sweeps, a drive that starts bypassed, and a tape delay (a macro).
  __()
    .saw({ id: 'bass', gate: 'closed' })
    .lowpass({ id: 'filter', frequency: 600, q: 6 })
    .overdrive({ id: 'drive', drive: 0.6, bypass: !driveOn })
    .gain({ id: 'level', gain: 0.22 })
    .tapedelay({ id: 'echo', time: 0.43, feedback: 0.5, mix: 0.3 })
    .to('main');
  __().lfo({ id: 'wobble', frequency: 0.4, depth: 350 }).modulate('#filter', 'frequency');

  // A lead that splits into a dry and a delayed branch.
  __()
    .monosynth({ id: 'lead', shape: 'square', cutoff: 1800, release: 0.2, gain: 0.5 })
    .split(
      (dry) => dry.gain({ id: 'dry', gain: 0.5 }),
      (wet) => wet.delay({ id: 'slap', time: 0.29, feedback: 0.3, mix: 1 }).panner(0.4),
    )
    .gain({ id: 'lead-level', gain: 0.25 })
    .to('main');

  // A chain nothing ever triggers: it stays still in the inspector.
  __().sine({ id: 'spare', gate: 'closed', frequency: 330 }).gain(0.2).to('main');

  if (extraVoice) {
    __()
      .noise({ id: 'hiss', gate: 'closed', color: 'pink' })
      .bandpass({ frequency: 3000, q: 4 })
      .gain(0.12)
      .to('drums');
    __.transport.sequence('hiss', { steps: 'x.xx', step: '1/8' }, (ev) => {
      if (ev.value) __('#hiss').trigger({ duration: 0.05 });
    });
  }

  for (let i = 0; i < stress; i++) {
    __()
      .sine({ class: 'stress', frequency: 110 + i * 7 })
      .lowpass(400 + i * 20)
      .gain(i % 3 === 0 ? 0 : 0.5 / Math.max(1, stress))
      .to('main');
  }

  __.transport.sequence('kick', { steps: 'x..x..x...x..x..' }, (ev) => {
    if (ev.value) __('#kick').trigger();
  });
  __.transport.sequence('snare', { steps: [0, 1], step: '1/4' }, (ev) => {
    if (ev.value) __('#snare').trigger();
  });
  __.transport.sequence('hat', { steps: 'x.xxx.x.', step: '1/8' }, (ev) => {
    if (ev.value) __('#hat').trigger();
  });
  __.transport.sequence(
    'bass',
    { steps: [55, 0, 55, 82.4, 0, 65.4, 0, 110], step: '1/8' },
    (ev) => {
      if (ev.value)
        __('#bass')
          .set({ frequency: ev.value })
          .trigger({ duration: ev.duration * 0.6 });
    },
  );
  __.transport.sequence('lead', { steps: [72, 0, 0, 75, 0, 79, 0, 0], step: '1/4' }, (ev) => {
    if (ev.value) __('#lead').trigger({ pitch: ev.value, duration: ev.duration * 0.5 });
  });
}

const toggle = document.querySelector<HTMLButtonElement>('#toggle')!;
const status = document.querySelector<HTMLSpanElement>('#status')!;
const message = document.querySelector<HTMLDivElement>('#message')!;
const voice = document.querySelector<HTMLButtonElement>('#voice')!;
const drive = document.querySelector<HTMLButtonElement>('#drive')!;
const modal = document.querySelector<HTMLButtonElement>('#modal')!;
let engine: Engine;
let inspector: Inspector;

async function rebuild(): Promise<void> {
  try {
    const result = await engine.scope('live').build(patch);
    const kept = result.unchanged.length + result.updated.length;
    message.textContent = `Built: ${kept} kept, ${result.added.length} new, ${result.removed.length} removed.`;
    message.classList.toggle('error', result.errors.length > 0);
    inspector.refresh();
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : String(error);
    message.classList.add('error');
  }
}

function updateStatus(): void {
  const running = engine.context.state === 'running';
  status.textContent = running ? 'Audio is running.' : 'Audio is paused: the meters are idle.';
  status.classList.toggle('running', running);
  toggle.textContent = running ? 'Stop audio' : 'Start audio';
}

async function boot(): Promise<void> {
  // The engine is made before any click, so the graph can be drawn while audio is still suspended.
  const context = new AudioContext();
  // A browser set up to allow sound without a click starts the context running. Begin paused
  // either way, so Start means the same thing everywhere.
  if (context.state === 'running') await context.suspend();
  engine = await createEngine({ context });
  engine.bus('main').gain.set(0.6);
  engine.on('state', updateStatus);
  engine.on('error', (error) => {
    message.textContent = error.message;
    message.classList.add('error');
  });
  addSamples(engine);
  inspector = createInspector(engine, {
    parent: document.querySelector<HTMLDivElement>('#inspector')!,
  });
  await rebuild();
  // For looking around from the console, and for the checks that drive this page.
  Object.assign(window, { engine, inspector });

  toggle.addEventListener('click', () => {
    void (async () => {
      if (engine.context.state === 'running') await (engine.context as AudioContext).suspend();
      else {
        await engine.resume();
        engine.transport.start();
      }
      updateStatus();
    })();
  });
  voice.addEventListener('click', () => {
    extraVoice = !extraVoice;
    voice.textContent = extraVoice ? 'Remove the voice' : 'Add a voice';
    void rebuild();
  });
  drive.addEventListener('click', () => {
    driveOn = !driveOn;
    drive.textContent = driveOn ? 'Bypass the drive' : 'Switch the drive on';
    void rebuild();
  });
  modal.addEventListener('click', () => {
    openInspector(engine.scope('live'), { mode: 'modal', title: 'Graph: live' });
  });
}

void boot();
