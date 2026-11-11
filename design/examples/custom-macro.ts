/**
 * Example 5: a custom macro with its own method, called directly and as a command.
 */

import { defineMacro, createEngine } from '../api';
import type { Command } from '../api';

/** Two detuned saws through a filter, with a `sweep` method of its own. */
const supersaw = defineMacro({
  type: 'supersaw',
  category: 'synth',
  params: {
    frequency: {
      default: 110,
      min: 20,
      max: 5000,
      unit: 'hz',
      curve: 'log',
      drives: [
        { select: '#a', param: 'frequency' },
        { select: '#b', param: 'frequency', scale: (hz) => hz * 1.01 },
      ],
    },
    cutoff: {
      default: 1200,
      min: 20,
      max: 20000,
      unit: 'hz',
      curve: 'log',
      drives: [{ select: '#filter', param: 'frequency' }],
    },
  },
  build(__) {
    __().lowpass({ id: 'filter' }).to('out');
    __().saw({ id: 'a' }).connect('#filter');
    __().saw({ id: 'b' }).connect('#filter');
  },
  methods: {
    sweep(__, args, at) {
      const to = typeof args['to'] === 'number' ? args['to'] : 4000;
      __('#filter').ramp('frequency', to, { at, duration: 0.5, curve: 'exp' });
    },
  },
});

export async function main(): Promise<void> {
  const engine = await createEngine({ context: new AudioContext(), nodes: [supersaw] });

  // Custom types are not in the built-in type map, so they are created through graph data
  // (or by augmenting NodeTypeMap, which adds a typed `.supersaw()` chain method).
  await engine.root.apply({
    nodes: [{ id: 'lead', type: 'supersaw', params: { frequency: 220 } }],
    edges: [{ from: 'lead', to: { bus: 'main' } }],
  });

  // The macro is one node from outside. Its internals are reached with a descendant selector.
  engine.select('#lead').set({ cutoff: 800 });
  engine.select('#lead lowpass').q(6);
  console.log(engine.select('*').length); // 1: `*` does not include macro internals

  // Its method, called directly...
  engine.select('#lead').call('sweep', { to: 6000 });

  // ...and as the command a sandboxed script would send.
  const fromSandbox: Command[] = [
    {
      op: 'call',
      target: '#lead',
      method: 'sweep',
      args: { to: 6000 },
      at: engine.context.currentTime + 0.1,
    },
  ];
  engine.root.dispatch(fromSandbox);
}
