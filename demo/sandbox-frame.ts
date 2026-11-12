/**
 * Runs inside the sandboxed frame. It imports only `cracked-up/remote` and the pure helpers: there is
 * no AudioContext here, and with an opaque origin no access to the parent page or its storage.
 */

import { createRemote } from '../src/remote';
import type { Remote } from '../src/remote';
import * as util from '../src/util';
import type { FromFrame, ToFrame } from './sandbox-protocol';

const helpers = {
  euclid: util.euclid,
  pitchToFreq: util.pitchToFreq,
  freqToPitch: util.freqToPitch,
  scales: util.scales,
  chords: util.chords,
  dbToGain: util.dbToGain,
};

// The frame's origin is opaque, so the parent cannot be named as a target origin: '*' is the only
// choice. Nothing secret is sent this way, only commands.
const post = (message: FromFrame): void => window.parent.postMessage(message, '*');

let remote: Remote | null = null;

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function run(code: string): void {
  if (!remote) return;
  try {
    const names = ['__', 'define', ...Object.keys(helpers)];
    const program = new Function(...names, `"use strict";\n${code}`) as (
      ...args: unknown[]
    ) => void;
    const active = remote;
    const define = (definition: Parameters<Remote['define']>[0]): void => active.define(definition);
    active.build((__) => program(__, define, ...Object.values(helpers)));
    post({ kind: 'result', error: null, nodes: remote.describe().nodes.length });
  } catch (error) {
    post({ kind: 'result', error: describe(error), nodes: remote.describe().nodes.length });
  }
}

window.addEventListener('message', (event: MessageEvent<ToFrame>) => {
  if (event.source !== window.parent) return;
  const data = event.data;
  if (data.kind === 'init') {
    remote = createRemote({ ...data.state, send: (message) => post({ kind: 'remote', message }) });
    remote.on('error', (error) =>
      post({ kind: 'result', error: error.message, nodes: remote?.describe().nodes.length ?? 0 }),
    );
  } else if (data.kind === 'run') run(data.code);
  else if (data.kind === 'host') remote?.receive(data.message);
});

post({ kind: 'ready' });
