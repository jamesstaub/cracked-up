/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import docsPage from '../../demo/docs.html?raw';
import { helpers, wrapUserCode } from '../../demo/helpers';
import { defineMacro } from '../../src';
import type { Engine, MacroDefinition, Scope } from '../../src';
import { offlineEngine } from '../core/setup';

/**
 * The docs section on macros has examples that open in the live demo. Each must run as written with
 * the names the demo provides: `__`, `engine`, the helpers, and `define`, which registers a macro
 * with the engine. What the section says about the examples is checked here too.
 */
describe('docs: macros', () => {
  const page = new DOMParser().parseFromString(docsPage, 'text/html');
  const blocks: string[] = [];
  for (
    let node = page.querySelector('#macros')?.nextElementSibling;
    node && node.tagName !== 'H2';
    node = node.nextElementSibling
  ) {
    if (node.tagName === 'PRE' && !node.hasAttribute('data-static')) {
      blocks.push(node.textContent ?? '');
    }
  }
  const blip = blocks.find((block) => block.includes("type: 'blip'")) ?? '';
  const drum = blocks.find((block) => block.includes("type: 'drum'")) ?? '';
  const chord = blocks.find((block) => block.includes("type: 'chord'")) ?? '';

  /** Runs a script the way the live demo does: through `build` on a scope called `live`. */
  async function run(engine: Engine, code: string): Promise<Scope> {
    const define = (definition: MacroDefinition): void =>
      engine.registry.register(defineMacro(definition));
    const program = new Function(
      '__',
      'engine',
      'define',
      ...Object.keys(helpers),
      wrapUserCode(code),
    );
    const scope = engine.scope('live');
    const result = await scope.build((__) =>
      program(__, engine, define, ...Object.values(helpers)),
    );
    expect(result.errors.map((error) => error.message)).toEqual([]);
    return scope;
  }

  const message = (fn: () => unknown): string => {
    try {
      fn();
    } catch (error) {
      return (error as Error).message;
    }
    return '';
  };

  it('has a simple example, a bigger one and the parts the contents list links to', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    expect(blip).not.toBe('');
    expect(drum).not.toBe('');
    // The simple one stays small.
    expect(blip.split('\n').length).toBeLessThanOrEqual(18);
    for (const id of [
      'macro-drum',
      'macro-chord',
      'macro-definition',
      'macro-outside',
      'macro-changing',
      'macro-errors',
    ]) {
      expect(page.querySelector(`#${id}`), id).not.toBeNull();
    }
    for (const block of blocks) expect(block).not.toContain('—');
  });

  it('runs every example without an error, and each is heard without clipping', async () => {
    for (const block of blocks) {
      const engine = await offlineEngine(4);
      const errors: string[] = [];
      engine.on('error', (error) => errors.push(error.message));
      await run(engine, block);
      engine.transport.start();
      const samples = (await engine.render()).getChannelData(0);
      expect(errors, block.slice(0, 60)).toEqual([]);
      const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
      expect(peak, block.slice(0, 60)).toBeGreaterThan(0.01);
      expect(peak, block.slice(0, 60)).toBeLessThan(1);
    }
  });

  it('the chord gives each voice its own value from one parameter', async () => {
    expect(chord).not.toBe('');
    const engine = await offlineEngine(1);
    const scope = await run(engine, chord);
    const voices = (param: string) =>
      scope.select('#pad .voice').nodes.map((node) => node.param(param).value as number);
    expect(voices('frequency')).toEqual([110, 132, 165, 198].map((hz) => expect.closeTo(hz, 9)));
    expect(voices('detune')).toEqual([-12, -4, 4, 12].map((c) => expect.closeTo(c, 9)));
    scope.select('#pad').set({ root: 100, spread: 0 });
    expect(voices('frequency')).toEqual([100, 120, 150, 180].map((hz) => expect.closeTo(hz, 9)));
    expect(voices('detune')).toEqual([0, 0, 0, 0].map((c) => expect.closeTo(c, 9)));
  });

  it('the drum is what the walk-through says it is', async () => {
    const engine = await offlineEngine(1);
    const scope = await run(engine, drum);
    // Two instances, one node each from outside, with their own insides.
    expect(scope.select('drum').nodes.map((node) => node.id)).toEqual(['kick', 'tom']);
    expect(scope.select('.kit')).toHaveLength(2);
    expect(scope.select('adsr')).toHaveLength(0);
    expect(scope.select('drum adsr')).toHaveLength(4);
    expect(scope.select('#kick > *')).toHaveLength(8);
    expect(scope.select('#kick').select('#lid')).toHaveLength(1);
    // One parameter drives several, each with its own scale, from the start.
    expect(scope.select('#tom #body').param('frequency').value).toBe(140);
    expect(scope.select('#tom #snap').param('frequency').value).toBe(1120);
    expect(scope.select('#kick #tick').param('decay').value).toBeCloseTo(0.07, 9);
    expect(scope.select('#kick #lid').param('frequency').value).toBeCloseTo(200 * 2 ** 1.2, 6);
    expect(scope.select('#tom #click').param('gain').value).toBe(0.25);
    // The lfo reaches `tune`; a scaled or control-rate parameter takes no signal.
    expect(scope.select('#tom').param('tune').modulators).toHaveLength(1);
    expect(message(() => scope.chain().lfo().modulate('#tom', 'tone'))).toBe(
      '"tone" of drum "tom" cannot be modulated: it is not an audio-rate parameter.',
    );
    // A glide steps what cannot ramp; a ramp of it is refused.
    scope.select('#tom').set({ decay: 0.5 }, { glide: 0.1 });
    expect(scope.select('#tom #shape').param('decay').value).toBe(0.5);
    expect(message(() => scope.select('#tom').ramp('decay', 1, { duration: 1 }))).toBe(
      '"decay" on adsr "shape" cannot be ramped: only audio-rate number parameters can.',
    );
    // The range is a control's, not a limit.
    scope.select('#tom').set({ tune: 500 });
    expect(scope.select('#tom #body').param('frequency').value).toBe(500);
    expect(message(() => scope.select('#tom').call('roll'))).toBe(
      'drum "tom" has no method called "roll".',
    );
    expect(message(() => scope.chain().sine().connect('#kick'))).toBe(
      'drum "kick" has no input, so sine "sine-0" cannot connect to it. ' +
        'To drive one of its parameters, use modulate().',
    );
    // As data it is one node.
    expect(scope.describe().nodes.find((node) => node.id === 'kick')).toEqual({
      id: 'kick',
      type: 'drum',
      classes: ['kit'],
      params: { tune: 50, decay: 0.35, tone: 0.2 },
    });
    expect(engine.registry.describe('drum')).toMatchObject({
      isMacro: true,
      triggerable: true,
      triggerOptions: { velocity: { type: 'number' } },
    });
  });

  it('a rebuild keeps an instance with the inside it was built with, as the section says', async () => {
    const engine = await offlineEngine(0.1);
    const script = (gain: number, id: string): string => `define({
  type: 'tone',
  params: {},
  build(__) { __().sine(220).gain({ id: 'level', gain: ${gain} }).to('out'); },
});
__().tone({ id: '${id}' }).to('main');`;
    const scope = await run(engine, script(0.1, 'a'));
    const first = scope.select('#a').first();
    await run(engine, script(0.5, 'a'));
    expect(scope.select('#a').first()).toBe(first);
    expect(scope.select('#a #level').param('gain').value).toBe(0.1);
    // Another id makes a new instance, from the definition as it is now.
    await run(engine, script(0.5, 'b'));
    expect(scope.select('#b #level').param('gain').value).toBe(0.5);
  });

  it('refuses what the table says, in those words', async () => {
    const engine = await offlineEngine(0.1);
    const register = (definition: Partial<MacroDefinition>): void =>
      engine.registry.register(defineMacro({ params: {}, build() {}, ...definition } as never));
    expect(message(() => register({ type: '2 x' }))).toBe(
      '"2 x" is not a valid node type name: use letters, digits, "_" and "-", starting with a letter.',
    );
    expect(message(() => register({ type: 'to' }))).toBe(
      '"to" cannot be a node type name because chains already have a method called "to".',
    );
    expect(message(() => register({ type: 'blip', shorthand: 'note' }))).toBe(
      'Node type "blip" names "note" as its shorthand, but has no such parameter.',
    );
    register({ type: 'leak', build: (__) => void __().sine().to('main') });
    register({ type: 'quiet', build: (__) => void __().sine() });
    const chain = (): Record<string, (init?: unknown) => { to(bus: string): void }> =>
      engine.chain() as never;
    expect(message(() => chain()['leak']!())).toContain(
      'Could not build leak "leak-0": There is no bus called "main" in scope "root/leak-0" or its parents.',
    );
    expect(message(() => chain()['quiet']!().to('main'))).toBe(
      'quiet "quiet-0" has no output to connect from.',
    );
    expect(message(() => chain()['quiet']!(3))).toBe(
      'quiet() takes an options object; it has no shorthand argument.',
    );
    // Without defineMacro the same object is taken for an ordinary node type.
    engine.registry.register({ type: 'plain', params: {}, build() {} } as never);
    expect(engine.registry.describe('plain').isMacro).toBe(false);
  });
});
