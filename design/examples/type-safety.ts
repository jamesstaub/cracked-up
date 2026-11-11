/**
 * Example 4: what the types catch. Each `@ts-expect-error` line fails the type check if the API stops
 * rejecting the mistake below it.
 */

import type { Engine } from '../api';

export function checks(engine: Engine): void {
  // A selection by type name knows its parameters.
  const samplers = engine.select('sampler');
  samplers.set({ speed: 2 });
  // @ts-expect-error samplers have no `frequency`
  samplers.set({ frequency: 440 });
  // @ts-expect-error not a sampler parameter
  samplers.ramp('cutoff', 1, { duration: 1 });
  samplers.trigger({ slice: 3, speed: 0.5 });

  // Chain methods check their options.
  engine.chain().lowpass({ frequency: 800, q: 2 }).gain(0.5).to('main');
  // @ts-expect-error `resonance` is not a lowpass option
  engine.chain().lowpass({ resonance: 2 });
  // @ts-expect-error there is no node type called `lowpas`
  engine.chain().lowpas(800);

  // A node's params are typed by name and value.
  const filter = engine.select('lowpass').first();
  if (filter) {
    filter.params.frequency.set(1200);
    // @ts-expect-error frequency is a number
    filter.params.frequency.set('high');
  }

  // Durations are checked as far as template types allow.
  engine.transport.sequence({ steps: 4, step: '1/8t' }, () => {});
  // @ts-expect-error not a duration
  engine.transport.sequence({ steps: 4, step: 'eighth' }, () => {});

  // A selection from an arbitrary selector is loose by design: any parameter name is accepted,
  // and nodes without it are skipped at runtime.
  engine.select('.tops, #bass').set({ gain: 0.5 });
}
