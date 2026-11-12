import { describe, expect, it } from 'vitest';
import { createEngine, defineMacro } from '../../src';
import type { Engine, MacroDefinition, NodeDefinition } from '../../src';
import { dbToGain } from '../../src/util';
import { findOnsets, rms } from '../helpers';
import { SAMPLE_RATE, click, ones, valueAt } from './setup';

/** An effect: passes its input through at a level set by `amount`. */
const fader = defineMacro({
  type: 'fader',
  category: 'utility',
  description: 'Test macro: a level control.',
  params: {
    amount: { default: 0.5, min: 0, max: 1, drives: [{ select: '#level', param: 'gain' }] },
    trimDb: {
      default: 0,
      min: -60,
      max: 12,
      unit: 'db',
      drives: [{ select: '#trim', param: 'gain', scale: dbToGain }],
    },
  },
  shorthand: 'amount',
  build(__) {
    __.bus('in').chain().gain({ id: 'level' }).gain({ id: 'trim' }).to('out');
  },
});

/** A source: plays a click when triggered, and has methods of its own. */
const blip = defineMacro({
  type: 'blip',
  category: 'source',
  description: 'Test macro: a click player.',
  params: {
    level: { default: 1, min: 0, max: 1, drives: [{ select: '#out-level', param: 'gain' }] },
    speed: { default: 1, min: 0.1, max: 4, rate: 'control', drives: [] },
  },
  build(__, init) {
    __()
      .sampler({ id: 'hit', buffer: init['buffer'] as AudioBuffer })
      .gain({ id: 'out-level' })
      .to('out');
  },
  trigger(__) {
    // No `at`: inside a macro's functions, operations happen at the time of the call.
    __('#hit').trigger();
  },
  methods: {
    flam(__, args, at) {
      const gap = typeof args['gap'] === 'number' ? args['gap'] : 0.01;
      __('#hit').trigger({ at });
      __('#hit').trigger({ at: at + gap });
    },
    addVoice(__, _args, _at, macro) {
      // Makes a node after build, giving it the macro's current setting.
      __()
        .sampler({ class: 'extra', speed: macro.value('speed') as number })
        .to('out');
    },
  },
});

async function engineWith(
  seconds: number,
  ...nodes: (NodeDefinition | MacroDefinition)[]
): Promise<Engine> {
  const context = new OfflineAudioContext(1, Math.round(SAMPLE_RATE * seconds), SAMPLE_RATE);
  return createEngine({ context, nodes });
}

/** Chain methods and setters for types defined in a test are not in the static type map. */
type Loose = Record<string, (...args: unknown[]) => Loose> & { to(bus: string): Loose };
const loose = (value: unknown) => value as Loose;

function constantInto(engine: Engine, seconds: number) {
  const chain = engine.chain().sampler({ id: 'dc', buffer: ones(seconds) });
  engine.select('#dc').trigger({ at: 0 });
  return loose(chain);
}

describe('macros', () => {
  it('an effect macro passes sound from its `in` bus to its `out` bus', async () => {
    const engine = await engineWith(0.2, fader);
    constantInto(engine, 0.2).fader!({ id: 'f' }).to('main');
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.5, 6);
  });

  it('exposed parameters drive inner ones: set, shorthand, scale, ramp and setters', async () => {
    const engine = await engineWith(1, fader);
    constantInto(engine, 1).fader!(0.25).to('main');
    const f = engine.select('fader');
    expect(f.param('amount').value).toBe(0.25);
    expect(engine.select('fader #level').param('gain').value).toBe(0.25);

    f.set({ trimDb: -6 }, { at: 0.25 });
    loose(f).amount!(1, { at: 0.5 });
    f.ramp('amount', 0, { at: 0.75, duration: 0.25 });
    const audio = await engine.render();
    expect(valueAt(audio, 0.1)).toBeCloseTo(0.25, 6);
    expect(valueAt(audio, 0.3)).toBeCloseTo(0.25 * dbToGain(-6), 6);
    expect(valueAt(audio, 0.6)).toBeCloseTo(dbToGain(-6), 6);
    expect(valueAt(audio, 0.875)).toBeCloseTo(0.5 * dbToGain(-6), 3);
    expect(f.param('amount').value).toBe(0);
  });

  it('an exposed parameter can be modulated when it drives an audio-rate parameter unscaled', async () => {
    const engine = await engineWith(0.2, fader);
    constantInto(engine, 0.2).fader!({ id: 'f', amount: 0.25 }).to('main');
    const mod = engine
      .chain()
      .sampler({ id: 'mod', buffer: ones(0.2) })
      .gain(0.5);
    engine.select('#mod').trigger({ at: 0 });
    mod.modulate('#f', 'amount');
    expect(engine.select('#f').param('amount').modulators).toHaveLength(1);
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.75, 6);
    // trimDb is scaled in code, so there is nothing a signal could be connected to.
    expect(() => mod.modulate('#f', 'trimDb')).toThrowError(/cannot be modulated/);
  });

  it('is one node from outside; its insides are reached with a descendant selector', async () => {
    const engine = await engineWith(0.1, fader);
    constantInto(engine, 0.1).fader!({ id: 'a' }).fader!({ id: 'b' }).to('main');
    expect(engine.select('*').nodes.map((node) => node.id)).toEqual(['dc', 'a', 'b']);
    expect(engine.select('gain')).toHaveLength(0);
    expect(engine.select('fader gain')).toHaveLength(4);
    expect(engine.select('#a gain').nodes.map((node) => node.id)).toEqual(['level', 'trim']);
    expect(engine.select('#a').select('#level')).toHaveLength(1);
    expect(engine.select('#b > #trim').first()?.parent?.id).toBe('b');
    // Each instance has its own ids, so changing one leaves the other alone.
    engine.select('#a #level').set({ gain: 0.1 });
    expect(engine.select('#b #level').param('gain').value).toBe(0.5);
    expect(engine.root.describe().nodes.map((node) => [node.id, node.type])).toEqual([
      ['dc', 'sampler'],
      ['a', 'fader'],
      ['b', 'fader'],
    ]);
  });

  it('trigger and methods run at the time of the call', async () => {
    const engine = await engineWith(1, blip);
    loose(engine.chain()).blip!({ id: 'b', buffer: click() }).to('main');
    const b = engine.select('#b');
    b.trigger({ at: 0.25 });
    b.call('flam', { gap: 0.02 }, { at: 0.5 });
    engine.root.dispatch([{ op: 'call', target: '#b', method: 'flam', args: {}, at: 0.75 }]);
    const audio = await engine.render();
    expect(findOnsets(audio, { threshold: 0.5, minGapSamples: 2 })).toEqual([
      12000, 24000, 24960, 36000, 36480,
    ]);
    expect(engine.registry.describe('blip')).toMatchObject({ isMacro: true, triggerable: true });
  });

  it('a macro triggered from a sequence lands on the step', async () => {
    const engine = await engineWith(1, blip);
    loose(engine.chain()).blip!({ id: 'b', buffer: click() }).to('main');
    engine.transport.sequence({ steps: 1, step: '1/4' }, () => engine.select('#b').trigger());
    engine.transport.start();
    expect(findOnsets(await engine.render(), { threshold: 0.5, minGapSamples: 2 })).toEqual([
      0, 24000,
    ]);
  });

  it("a method can read the macro's settings to make nodes later", async () => {
    const engine = await engineWith(0.1, blip);
    loose(engine.chain()).blip!({ id: 'b', buffer: click(), speed: 2 }).to('main');
    engine.select('#b').call('addVoice');
    expect(engine.select('#b .extra').param('speed').value).toBe(2);
  });

  it('a source macro has no input, and nothing inside can reach buses outside', async () => {
    const engine = await engineWith(0.1, blip);
    expect(() => loose(engine.chain().gain()).blip!({ buffer: click() })).toThrowError(/no input/);

    const leaky = defineMacro({
      type: 'leaky',
      params: {},
      build(__) {
        __().gain().to('main');
      },
    });
    const other = await engineWith(0.1, leaky);
    expect(() => loose(other.chain()).leaky!()).toThrowError(/no bus called "main"/);
    // The failed build left nothing behind.
    expect(other.select('*')).toHaveLength(0);
  });

  it('macros nest', async () => {
    const double = defineMacro({
      type: 'double',
      params: {
        amount: { default: 0.5, min: 0, max: 1, drives: [{ select: 'fader', param: 'amount' }] },
      },
      build(__) {
        const chain = __.bus('in').chain() as unknown as Loose;
        chain.fader!({ id: 'first' }).fader!({ id: 'second' }).to('out');
      },
    });
    const engine = await engineWith(0.2, fader, double);
    constantInto(engine, 0.2).double!({ id: 'd' }).to('main');
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.25, 6);
    expect(engine.select('double fader gain')).toHaveLength(4);
    expect(engine.select('#d > fader')).toHaveLength(2);
    expect(engine.select('#d > gain')).toHaveLength(0);
  });

  it('disposing a macro disposes what is inside it', async () => {
    const engine = await engineWith(0.2, fader);
    constantInto(engine, 0.2).fader!({ id: 'f' }).to('main');
    const inner = engine.select('#f gain').nodes;
    engine.select('#f').dispose();
    expect(inner.every((node) => node.disposed)).toBe(true);
    expect(engine.select('fader')).toHaveLength(0);
    expect(rms(await engine.render())).toBe(0);
  });
});
