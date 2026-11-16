/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { renderRoute, routeLines, routeModel } from '../../demo/bus-graph';
import docsPage from '../../demo/docs.html?raw';
import { helpers, wrapUserCode } from '../../demo/helpers';
import type { Engine, Scope } from '../../src';
import { constant, offlineEngine, ones, valueAt } from '../core/setup';

const page = new DOMParser().parseFromString(docsPage, 'text/html');

/** Every example of the section on `main` and buses: from its heading to the next section's. */
const examples: HTMLPreElement[] = [];
for (
  let node = page.querySelector('#output')?.nextElementSibling;
  node && node.tagName !== 'H2';
  node = node.nextElementSibling
) {
  if (node instanceof HTMLPreElement) examples.push(node);
  else examples.push(...node.querySelectorAll('pre'));
}
const text = (block: Element): string => block.textContent ?? '';

/** Runs an example the way the live demo does: with the helpers, in a scope below the root. */
async function build(engine: Engine, source: string): Promise<Scope> {
  const scope = engine.root.scope('live');
  const program = new Function('__', ...Object.keys(helpers), wrapUserCode(source)) as (
    ...values: unknown[]
  ) => void;
  await scope.build((__) => program(__, ...Object.values(helpers)));
  return scope;
}

describe('docs: buses', () => {
  const runnable = examples.filter((block) => !block.hasAttribute('data-static')).map(text);

  it('has the parts other pages link to, and runnable examples', () => {
    for (const id of ['bus-model', 'bus-cases', 'bus-chain', 'bus-recipes', 'inserts']) {
      expect(page.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect(runnable.length).toBeGreaterThanOrEqual(10);
    expect(runnable.some((block) => block.includes("__.bus('drums').overdrive("))).toBe(true);
    for (const block of runnable) expect(block).not.toContain('—');
  });

  it('runs every example without an error, and each is heard', async () => {
    for (const block of runnable) {
      const engine = await offlineEngine(2);
      for (const key of ['kick', 'snare', 'hat']) engine.buffers.add(key, ones(0.2));
      const errors: string[] = [];
      engine.on('error', (error) => errors.push(error.message));
      await build(engine, block);
      engine.transport.start();
      const rendered = await engine.render();
      expect(errors, block.slice(0, 60)).toEqual([]);
      const heard = rendered.getChannelData(0).some((sample) => Math.abs(sample) > 0.01);
      expect(heard, block.slice(0, 60)).toBe(true);
    }
  });
});

/**
 * The routing each pictured example is meant to build, in the words `routeLines` uses. A picture is
 * drawn from the same model these lines are read from, so if an example or the library changes what
 * is connected to what, this fails before the page shows a different picture under the same prose.
 */
const MAIN = 'bus main goes to the speakers';
const PICTURES: readonly (readonly string[])[] = [
  // What a bus is made of.
  [
    'kick goes to bus drums',
    'snare goes to bus drums',
    'bus drums: input, insert tone (lowpass), level 0.8, output; its output goes to bus main',
    MAIN,
  ],
  // 1. One fader for a group.
  [
    'kick goes to bus drums',
    'hat goes to bus drums',
    'bus drums: input, level 0.8, output; its output goes to bus main',
    MAIN,
  ],
  // 2. An insert.
  [
    'kick goes to bus drums',
    'bus drums: input, insert grit (overdrive), insert tone (lowpass), level 1, output; its output goes to bus main',
    MAIN,
  ],
  // 3. A group inside a group.
  [
    'hat goes to bus hats',
    'kick goes to bus drums',
    'bus hats: input, level 0.5, output; its output goes to bus drums',
    'bus drums: input, level 0.8, output; its output goes to bus main',
    MAIN,
  ],
  // 4. A chain from the bus.
  [
    'kick goes to bus drums',
    'snare goes to bus drums',
    'bus drums: input, level 1, output; its output goes to bus main',
    'a copy of the output of bus drums goes to smash',
    'smash goes to smash-level',
    'smash-level goes to bus main',
    MAIN,
  ],
  // 5. The same effect as an insert...
  [
    'kick goes to bus drums',
    'bus drums: input, insert crush (overdrive), level 1, output; its output goes to bus main',
    MAIN,
  ],
  // ...and in a chain from the bus.
  [
    'kick goes to bus drums',
    'bus drums: input, level 1, output; its output goes to bus main',
    'a copy of the output of bus drums goes to crush',
    'crush goes to bus main',
    MAIN,
  ],
  // 6. to(null) and two chains.
  [
    'kick goes to bus drums',
    'hat goes to bus drums',
    'bus drums: input, level 1, output; its output goes nowhere',
    'a copy of the output of bus drums goes to lows',
    'a copy of the output of bus drums goes to highs',
    'lows goes to bus main',
    'highs goes to echo',
    'echo goes to bus main',
    MAIN,
  ],
  // A shared reverb.
  [
    'snare goes to bus main',
    'snare goes to snare-send',
    'hat goes to gain-0',
    'hat goes to hat-send',
    'snare-send goes to bus room',
    'gain-0 goes to bus main',
    'hat-send goes to bus room',
    'bus room: input, insert space (reverb), level 1, output; its output goes to bus main',
    MAIN,
  ],
  // An insert and a chain from the same bus.
  [
    'kick goes to bus drums',
    'snare goes to bus drums',
    'bus drums: input, insert glue (compressor), level 1, output; its output goes to bus main',
    'a copy of the output of bus drums goes to crush',
    'crush goes to gain-0',
    'gain-0 goes to bus main',
    MAIN,
  ],
  // A recorder.
  [
    'bus drums: input, level 1, output; its output goes to bus main',
    'a copy of the output of bus drums goes to stem',
    MAIN,
  ],
];

describe('docs: the routing pictures', () => {
  const pictured = examples.filter((block) => block.hasAttribute('data-graph'));

  it('has a picture for every case', () => {
    expect(pictured.length).toBe(PICTURES.length);
  });

  it('draws what each example builds', async () => {
    for (const [index, block] of pictured.entries()) {
      const engine = await offlineEngine(0.1);
      const scope = await build(engine, text(block));
      const model = routeModel(scope.snapshot());
      const lines = routeLines(model);
      expect(lines, text(block).slice(0, 60)).toEqual(PICTURES[index]);

      // The drawing has a line for every connection, the two kinds of line a bus's output can
      // take are told apart in words, and the whole is described for someone who cannot see it.
      const picture = renderRoute(model);
      const count = (selector: string): number => picture.querySelectorAll(selector).length;
      const labels = (selector: string): string[] =>
        [...picture.querySelectorAll(selector)].map((label) => label.textContent ?? '');
      const copies = model.edges.filter((edge) => edge.kind === 'copy').length;
      const own = model.edges.filter((edge) => edge.kind === 'own');
      const detached = model.units.filter((unit) => unit.kind === 'bus' && unit.detached).length;
      expect(count('path[marker-end]')).toBe(model.edges.length);
      expect(count('path.edge.copy')).toBe(copies);
      expect(labels('text.label.copy')).toEqual(Array<string>(copies).fill('copy'));
      expect(labels('text.label.own').sort()).toEqual(
        [
          ...own.map((edge) => `to ${edge.to.slice('bus:'.length)}`),
          ...Array<string>(detached).fill('to(null): nowhere'),
        ].sort(),
      );
      expect(count('g.bus:not(.closed)')).toBe(scope.snapshot().buses.length);
      expect(picture.getAttribute('role')).toBe('img');
      expect(picture.getAttribute('aria-label')).toBe(`${lines.join('. ')}.`);
    }
  });
});

/**
 * What the section says you hear, measured. A constant signal of 1 goes into a bus called `drums`,
 * so the level that reaches the output says which paths the signal took.
 */
describe('docs: what the buses section says you hear', () => {
  async function level(route: (engine: Engine) => void): Promise<number> {
    const engine = await offlineEngine(0.2);
    route(engine);
    constant(engine, 0.2).to('drums');
    return valueAt(await engine.render(), 0.1);
  }

  it('a bus goes to main at its level, and an insert changes all of it', async () => {
    expect(await level((engine) => engine.bus('drums').gain.set(0.8))).toBeCloseTo(0.8);
    expect(await level((engine) => engine.bus('drums').insert().gain(0.5))).toBeCloseTo(0.5);
  });

  it('a chain from a bus adds to it, and only once the chain ends somewhere', async () => {
    expect(await level((engine) => engine.bus('drums').chain().gain(0.25).to('main'))).toBeCloseTo(
      1.25,
    );
    expect(await level((engine) => engine.bus('drums').chain().gain(0.25))).toBeCloseTo(1);
  });

  it('the copy is taken after the inserts and the level', async () => {
    const heard = await level((engine) => {
      const drums = engine.bus('drums');
      drums.gain.set(0.8);
      drums.insert().gain(0.5).chain().gain(0.25).to('main');
    });
    expect(heard).toBeCloseTo(0.4 + 0.4 * 0.25);
  });

  it('a bus sent to another bus is heard through that bus only', async () => {
    const heard = await level((engine) => {
      engine.bus('group').gain.set(0.8);
      engine.bus('drums').to('group').gain.set(0.5);
    });
    expect(heard).toBeCloseTo(0.4);
  });

  it('to(null) leaves only the chains, and silence without one', async () => {
    expect(await level((engine) => engine.bus('drums').to(null))).toBe(0);
    expect(
      await level((engine) => engine.bus('drums').to(null).chain().gain(0.25).to('main')),
    ).toBeCloseTo(0.25);
    // With one chain it does the job of the insert.
    expect(await level((engine) => engine.bus('drums').insert().gain(0.25))).toBeCloseTo(0.25);
    expect(await level((engine) => engine.bus('drums').to(null).to('main'))).toBeCloseTo(1);
  });

  it('a rebuild that no longer asks for a destination or a chain puts the bus back', async () => {
    const engine = await offlineEngine(0.2);
    const drums = (scope: { bus: Engine['bus']; chain: Engine['chain'] }) => {
      scope
        .chain()
        .sampler({ id: 'dc', buffer: ones(0.2) })
        .to('drums');
    };
    await engine.root.build((__) => {
      __.bus('drums').to(null).chain().gain({ id: 'quiet', gain: 0.25 }).to('main');
      drums(__.scope);
    });
    expect(engine.root.snapshot().buses.find((bus) => bus.name === 'drums')?.to).toBeNull();
    expect(engine.root.describe().edges).toContainEqual({
      from: { bus: 'drums' },
      to: { node: 'quiet' },
    });
    await engine.root.build((__) => {
      __.bus('drums');
      drums(__.scope);
    });
    expect(engine.root.snapshot().buses.find((bus) => bus.name === 'drums')?.to).toBe('main');
    expect(engine.root.describe().edges).toEqual([{ from: 'dc', to: { bus: 'drums' } }]);
    engine.select('#dc').trigger({ at: 0 });
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(1);
  });
});
