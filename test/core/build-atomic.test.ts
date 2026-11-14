import { describe, expect, it } from 'vitest';
import { defineMacro, defineNode } from '../../src';
import type { ApplyResult, Engine, GraphError, Scope, ScopeApi } from '../../src';
import { offlineEngine } from './setup';

/**
 * `build()` happens whole or not at all. Each case below runs a build that makes many good changes
 * and one bad one, and checks that the scope then renders, describes itself and schedules exactly as
 * if that build had never been run; and that a corrected build afterwards does everything.
 */

const SECONDS = 0.5;

/** An effect with a parameter of each kind, a creation option that can fail, and code that can throw. */
const unit = defineNode({
  type: 'unit',
  category: 'utility',
  params: {
    level: { default: 1, min: 0, max: 2 },
    mode: { kind: 'choice', choices: ['soft', 'hard'], default: 'soft', rate: 'control' },
    on: { kind: 'boolean', default: true, rate: 'control' },
  },
  build(context, init) {
    if (init['explode'] === true) throw new Error('kaboom');
    const level = new GainNode(context.audio);
    const mode = new GainNode(context.audio);
    const on = new GainNode(context.audio);
    level.connect(mode).connect(on);
    return {
      input: level,
      output: on,
      params: {
        level: level.gain,
        mode: (value, at) => mode.gain.setValueAtTime(value === 'hard' ? 0.5 : 1, at),
        on: (value, at) => on.gain.setValueAtTime(value === true ? 1 : 0, at),
      },
      methods: {
        duck: (_args, at) => on.gain.setValueAtTime(0.25, at),
        boom: () => {
          throw new Error('boom');
        },
      },
    };
  },
});

/** A macro whose exposed parameters drive inner ones, one of them through a function. */
const voice = defineMacro({
  type: 'voice',
  category: 'utility',
  params: {
    amount: { default: 0.5, min: 0, max: 1, drives: [{ select: '#body', param: 'gain' }] },
    depth: {
      default: 1,
      min: 0,
      max: 4,
      // Not a number below zero, which the inner parameter refuses.
      drives: [{ select: '#root', param: 'gain', scale: (value: number) => Math.sqrt(value) }],
    },
  },
  build(__, init) {
    if (init['fail'] === true) throw new Error('no voice');
    __.bus('in').chain().gain({ id: 'body' }).gain({ id: 'root' }).to('out');
  },
});

type Loose = Record<string, (...args: unknown[]) => Loose> & { to(bus: string): Loose };
const loose = (value: unknown) => value as Loose;

type Step = (__: ScopeApi, fired: string[]) => void;

/** The chain the cases about a node's own options re-declare, well or badly. */
const spare =
  (osc: object, fx: object, macro: object): Step =>
  (__) => {
    loose(__().sine({ id: 'spare', ...osc })).unit!({ id: 'spareunit', ...fx }).voice!({
      id: 'sparevoice',
      ...macro,
    }).gain!({ id: 'sparelevel', gain: 0.05 }).to('main');
  };

const base: Step = (__, fired) => {
  loose(__().saw({ id: 'osc', frequency: 110 }).lowpass({ id: 'filter', frequency: 800 })).unit!({
    id: 'unit',
    level: 0.8,
  }).gain!({ id: 'level', gain: 0.5 }).to('main');
  __().sine({ id: 'tone', frequency: 330 }).gain({ id: 'send', gain: 0.2 }).to(__.bus('fx'));
  __.bus('fx').insert().gain({ id: 'trim', gain: 0.5 });
  spare({ frequency: 200 }, {}, {})(__, fired);
  __.transport.sequence('seq', { steps: 'x.x.', step: '1/16' }, (event) => {
    fired.push(`old:${event.index}=${event.value}@${event.time.toFixed(6)}`);
    __('#send').set({ gain: event.value > 0 ? 0.3 : 0.1 });
  });
};

const goodSpare = spare({ frequency: 300 }, { mode: 'hard', level: 0.5 }, { amount: 0.8 });

/**
 * A build that changes a bit of everything: values of kept nodes, new nodes, a replaced insert, a
 * new bus and a re-routed one, sets, a ramp and a bypass on nodes that were already there, a node of
 * a child scope, sequences, the tempo. `part` goes in the middle of it.
 */
const changed =
  (part: Step): Step =>
  (__, fired) => {
    __.transport.bpm = 90;
    __.bus('aux').to('fx');
    loose(__().saw({ id: 'osc', frequency: 220 }).lowpass({ id: 'filter', frequency: 2000 })).unit!(
      { id: 'unit', level: 0.3, mode: 'hard' },
    ).gain!({ id: 'level', gain: 0.5 }).to('main');
    __().sine({ id: 'tone', frequency: 330 }).gain({ id: 'send', gain: 0.2 }).to('aux');
    __.bus('fx').insert().lowpass({ id: 'dark', frequency: 500 });
    __.bus('fx').gain.set(0.7);
    __.bus('fx').to(null).chain().gain({ id: 'tap', gain: 0.5 }).to('main');
    __().sine({ id: 'extra', frequency: 550 }).gain({ id: 'extralevel', gain: 0.1 }).to('main');
    __('#level').set({ gain: 0.9 });
    __('#extralevel').set({ gain: 0.2 });
    __('#tone').ramp('frequency', 660, { duration: 0.1 });
    __('#filter').bypass();
    loose(__('#unit')).call!('duck');
    __('#kidlevel').set({ gain: 0.3 });
    __.transport.sequence('seq', { steps: 'xxxx', step: '1/8' }, (event) => {
      fired.push(`new:${event.index}=${event.value}@${event.time.toFixed(6)}`);
    });
    __.transport.sequence('more', { steps: 'x', step: '1/4' }, (event) => {
      fired.push(`more@${event.time.toFixed(6)}`);
    });
    __.transport.every('1/4', (event) => fired.push(`every@${event.time.toFixed(6)}`));
    part(__, fired);
    __('#send').set({ gain: 0.05 });
    __('#osc').disconnect();
    __('#osc').connect('#filter');
  };

const corrected = changed(goodSpare);
/** A good version of everything, then one more request. */
const withBad = (bad: Step): Step =>
  changed((__, fired) => {
    goodSpare(__, fired);
    bad(__, fired);
  });

type Outcome = { result: ApplyResult } | { error: GraphError };

async function play(steps: readonly Step[]) {
  const engine = await offlineEngine(SECONDS);
  engine.registry.register(unit);
  engine.registry.register(voice);
  const scope = engine.scope('track');
  const child = scope.scope('inner');
  child.chain().sine({ id: 'kid', frequency: 440 }).gain({ id: 'kidlevel', gain: 0.1 }).to('main');
  const fired: string[] = [];
  const events: string[] = [];
  const outcomes: Outcome[] = [];
  for (const [index, step] of steps.entries()) {
    try {
      outcomes.push({ result: await scope.build((__) => step(__, fired)) });
    } catch (error) {
      outcomes.push({ error: error as GraphError });
    }
    if (index > 0) continue;
    // From here on everything the scope and a kept parameter announce is noted.
    scope.transport.get('seq')!.setStep(3, 0.5);
    for (const which of [scope, child]) {
      which.on('param:changed', (change) =>
        events.push(`${change.param.node.id}.${change.param.name}=${String(change.value)}`),
      );
      which.on('node:added', (node) => events.push(`+${node.id}`));
      which.on('node:removed', (id) => events.push(`-${id}`));
    }
    const level = scope.select('#level').param('gain');
    level.on('change', (change) => events.push(`level heard ${String(change.value)}`));
    engine.transport.on('tempo', (bpm) => events.push(`tempo ${bpm}`));
  }
  const state = {
    graph: scope.describe(),
    childGraph: child.describe(),
    buses: scope.snapshot().buses,
    bypassed: scope.select('*').nodes.map((node) => `${node.id}:${String(node.bypass)}`),
    bpm: engine.transport.bpm,
    sequences: scope.transport.sequences.map((sequence) => ({
      name: sequence.name,
      steps: [...sequence.steps],
      options: sequence.options,
    })),
  };
  // What listeners were told while building. Sequence callbacks set values during the render too.
  const told = [...events];
  engine.transport.start();
  const audio = (await engine.render()).getChannelData(0).slice();
  return { engine, scope, audio, state, fired, events: told, outcomes };
}

type Played = Awaited<ReturnType<typeof play>>;

/**
 * The first sample at which two renders differ, or -1. Several signals meet at `main`, and a
 * browser may add them up in a different order from one context to the next, so two renders of the
 * same graph can differ in the last bit. Anything a build changes here moves samples by far more.
 */
function firstDifference(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 1e-6) return i;
  return -1;
}

function expectSame(actual: Played, expected: Played): void {
  expect(actual.state).toEqual(expected.state);
  expect(actual.fired).toEqual(expected.fired);
  expect(firstDifference(actual.audio, expected.audio)).toBe(-1);
}

const ids = (nodes: Iterable<{ id: string }>): string[] => [...nodes].map((node) => node.id);
const summary = (outcome: Outcome | undefined) => {
  if (!outcome || 'error' in outcome) throw new Error('the build was refused');
  const { added, removed, updated, unchanged, errors } = outcome.result;
  return {
    added: ids(added),
    removed: [...removed],
    updated: ids(updated),
    unchanged: ids(unchanged),
    errors,
  };
};

let untouched: Promise<Played> | null = null;
let direct: Promise<Played> | null = null;
/** The base build alone, and the base build followed by the corrected one. */
const references = () => ({
  untouched: (untouched ??= play([base])),
  direct: (direct ??= play([base, corrected])),
});

interface Refusal {
  code: GraphError['code'];
  message: RegExp;
  nodeId?: string;
}

const cases: [string, Step, Refusal][] = [
  [
    'a kept node declared with a value of the wrong kind',
    changed(spare({ frequency: 'loud' }, { mode: 'hard', level: 0.5 }, { amount: 0.8 })),
    {
      code: 'invalid-param',
      nodeId: 'spare',
      message: /"frequency" on sine "spare" needs a finite/,
    },
  ],
  [
    'a kept node declared with a number that is not finite',
    changed(spare({ frequency: Number.NaN }, { mode: 'hard' }, {})),
    { code: 'invalid-param', nodeId: 'spare', message: /"frequency" on sine "spare"/ },
  ],
  [
    'a kept node declared with a choice it does not have',
    changed(spare({ frequency: 300 }, { mode: 'medium', level: 0.5 }, { amount: 0.8 })),
    {
      code: 'invalid-param',
      nodeId: 'spareunit',
      message: /"mode" on unit "spareunit" must be one of soft, hard; got "medium"/,
    },
  ],
  [
    'a kept node declared with something that is not true or false',
    changed(spare({ frequency: 300 }, { on: 'yes' }, {})),
    {
      code: 'invalid-param',
      nodeId: 'spareunit',
      message: /"on" on unit "spareunit" needs true or false/,
    },
  ],
  [
    'a kept node whose creation option changed, so it is replaced, and the replacement fails',
    changed(spare({ frequency: 300 }, { explode: true }, {})),
    {
      code: 'build-failed',
      nodeId: 'spareunit',
      message: /Could not build unit "spareunit": kaboom/,
    },
  ],
  [
    'a kept macro instance declared with a bad value',
    changed(spare({ frequency: 300 }, { mode: 'hard' }, { amount: 'lots' })),
    {
      code: 'invalid-param',
      nodeId: 'sparevoice',
      message: /"amount" on voice "sparevoice" needs a finite number/,
    },
  ],
  [
    'a kept macro instance given a value an inner parameter refuses',
    changed(spare({ frequency: 300 }, { mode: 'hard' }, { depth: -1 })),
    {
      code: 'invalid-param',
      nodeId: 'root',
      message: /"gain" on gain "root" needs a finite number/,
    },
  ],
  [
    'a macro instance that is replaced and whose own build fails',
    changed(spare({ frequency: 300 }, { mode: 'hard' }, { fail: true })),
    {
      code: 'build-failed',
      nodeId: 'sparevoice',
      message: /Could not build voice "sparevoice": no voice/,
    },
  ],
  [
    'a new node with a bad value',
    withBad((__) => void __().lowpass({ id: 'fresh', frequency: 'loud' as never })),
    { code: 'invalid-param', nodeId: 'fresh', message: /"frequency" on lowpass "fresh"/ },
  ],
  [
    'an id used twice',
    withBad((__) => void __().gain({ id: 'level' })),
    { code: 'duplicate-id', nodeId: 'level', message: /already has a node with the id "level"/ },
  ],
  [
    'a node type that does not exist',
    withBad((__) => void loose(__()).nope!()),
    { code: 'build-failed', message: /nope/ },
  ],
  [
    'set() with a value of the wrong kind on a kept node',
    withBad((__) => void __('#sparelevel').set({ gain: 'loud' as never })),
    { code: 'invalid-param', nodeId: 'sparelevel', message: /"gain" on gain "sparelevel"/ },
  ],
  [
    'a shortcut setter with a bad value on a kept node',
    withBad((__) => void loose(__('#spare')).frequency!(Number.POSITIVE_INFINITY)),
    { code: 'invalid-param', nodeId: 'spare', message: /"frequency" on sine "spare"/ },
  ],
  [
    'set() with a choice the kept node does not have',
    withBad((__) => void __('#spareunit').set({ mode: 'medium' })),
    { code: 'invalid-param', nodeId: 'spareunit', message: /"mode" on unit "spareunit"/ },
  ],
  [
    'a bad value set through the parameter itself',
    withBad((__) => void __('#sparelevel').param('gain').set('loud')),
    { code: 'invalid-param', nodeId: 'sparelevel', message: /"gain" on gain "sparelevel"/ },
  ],
  [
    'a bad value set on a kept macro instance',
    withBad((__) => void __('#sparevoice').set({ depth: -4 })),
    { code: 'invalid-param', nodeId: 'root', message: /"gain" on gain "root"/ },
  ],
  [
    'a set at a time that cannot be',
    withBad((__) => void __('#sparelevel').set({ gain: 0.1 }, { at: -1 })),
    { code: 'invalid-param', nodeId: 'sparelevel', message: /needs a time of 0 or more seconds/ },
  ],
  [
    'a ramp to something that is not a number',
    withBad((__) => void __('#sparelevel').ramp('gain', Number.NaN, { duration: 0.1 })),
    { code: 'invalid-param', nodeId: 'sparelevel', message: /"gain" on gain "sparelevel"/ },
  ],
  [
    'a ramp of a parameter that cannot be ramped',
    withBad((__) => void __('#spareunit').ramp('on', 1, { duration: 0.1 })),
    {
      code: 'invalid-param',
      nodeId: 'spareunit',
      message: /"on" on unit "spareunit" cannot be ramped/,
    },
  ],
  [
    'a ramp with a duration that cannot be',
    withBad((__) => void __('#sparelevel').ramp('gain', 1, { duration: -1 })),
    { code: 'invalid-param', nodeId: 'sparelevel', message: /ramp needs a duration of 0 or more/ },
  ],
  [
    'an offset that is not a number',
    withBad((__) => void __('#sparelevel').offset('gain', Number.NaN)),
    { code: 'invalid-param', nodeId: 'sparelevel', message: /offset must be a finite number/ },
  ],
  [
    'a method the node does not have',
    withBad((__) => void __('#spareunit').call('nope')),
    { code: 'invalid-command', nodeId: 'spareunit', message: /no method called "nope"/ },
  ],
  [
    'a connection to a node that does not exist',
    withBad((__) => void __('#spare').connect('#ghost')),
    { code: 'missing-target', message: /Nothing in scope "track" matches "#ghost"/ },
  ],
  [
    'a connection to a node with no input',
    withBad((__) => void __('#sparelevel').connect('#osc')),
    { code: 'missing-target', nodeId: 'osc', message: /saw "osc" has no input/ },
  ],
  [
    'a chain sent to a bus that does not exist',
    withBad((__) => void __('#sparelevel').to('nowhere')),
    { code: 'missing-target', message: /no bus called "nowhere"/ },
  ],
  [
    'a modulator aimed at a parameter that cannot be modulated',
    withBad((__) => void __('#spare').chain().modulate('#spareunit', 'mode')),
    { code: 'invalid-param', nodeId: 'spareunit', message: /cannot be modulated/ },
  ],
  [
    'a bus routed to a bus that does not exist',
    withBad((__) => void __.bus('fx').to('nowhere')),
    { code: 'missing-target', message: /no bus called "nowhere"/ },
  ],
  [
    'a bus routed to itself',
    withBad((__) => void __.bus('aux').to('aux')),
    { code: 'missing-target', message: /Bus "aux" cannot be routed to itself/ },
  ],
  [
    'an insert that has no input',
    withBad((__) => void __.bus('fx').sine({ id: 'whistle' })),
    { code: 'missing-target', nodeId: 'whistle', message: /cannot be an insert on bus "fx"/ },
  ],
  [
    'a level that is not a number on a kept bus',
    withBad((__) => void __.bus('fx').gain.set('loud' as never)),
    { code: 'invalid-param', message: /"gain" on gain "bus:fx"/ },
  ],
  [
    'a named sequence replaced with options that cannot be',
    withBad((__) => void __.transport.sequence('seq', { steps: 0 }, () => undefined)),
    { code: 'build-failed', message: /at least one step/ },
  ],
  [
    'a new sequence with options that cannot be',
    withBad(
      (__) =>
        void __.transport.sequence(
          'odd',
          { steps: 'x.', step: '1/8', span: '1/1' },
          () => undefined,
        ),
    ),
    { code: 'build-failed', message: /either "step" or "span"/ },
  ],
  [
    'a tempo that cannot be',
    withBad((__) => void (__.transport.bpm = -1)),
    { code: 'build-failed', message: /bpm must be a number above 0/ },
  ],
  [
    'a bad value for a node of a child scope',
    withBad((__) => void __('#kidlevel').set({ gain: 'loud' as never })),
    { code: 'invalid-param', nodeId: 'kidlevel', message: /"gain" on gain "kidlevel"/ },
  ],
  [
    'a builder that throws',
    withBad(() => {
      throw new Error('half-typed');
    }),
    { code: 'build-failed', message: /^half-typed$/ },
  ],
];

describe('build is all or nothing', () => {
  it('renders the same twice', async () => {
    const [one, two] = await Promise.all([play([base]), play([base])]);
    expectSame(one, two);
    const [three, four] = await Promise.all([play([base, corrected]), play([base, corrected])]);
    expectSame(three, four);
  });

  it('the corrected build of these tests does change everything it touches', async () => {
    const { untouched, direct } = references();
    const [before, after] = await Promise.all([untouched, direct]);
    expect(firstDifference(before.audio, after.audio)).not.toBe(-1);
    expect(after.state).not.toEqual(before.state);
    expect(after.state.bpm).toBe(90);
    expect(after.fired.some((entry) => entry.startsWith('new:'))).toBe(true);
    expect(after.fired.some((entry) => entry.startsWith('old:'))).toBe(false);
    expect(before.fired.some((entry) => entry.startsWith('old:3=0.5'))).toBe(true);
    expect(summary(after.outcomes[1]).errors).toEqual([]);
    expect(after.events).toContain('level heard 0.9');
    expect(after.events).toContain('tempo 90');
    expect(after.events).toContain('kidlevel.gain=0.3');
    expect(after.events).toContain('-trim');
    // A new node is announced before anything is said about its parameters.
    expect(after.events.indexOf('+extralevel')).toBeGreaterThan(-1);
    expect(after.events.indexOf('extralevel.gain=0.2')).toBeGreaterThan(
      after.events.indexOf('+extralevel'),
    );
  });

  for (const [name, step, refusal] of cases) {
    it(`refuses the whole build: ${name}`, async () => {
      const failed = await play([base, step]);
      const outcome = failed.outcomes[1]!;
      if (!('error' in outcome)) throw new Error('the build was not refused');
      expect(outcome.error.code).toBe(refusal.code);
      expect(outcome.error.message).toMatch(refusal.message);
      if (refusal.nodeId !== undefined) expect(outcome.error.nodeId).toBe(refusal.nodeId);

      // Exactly as if it had never been run.
      const { untouched, direct } = references();
      expectSame(failed, await untouched);
      // The tempo is the one thing listeners hear of twice: changed, then changed back.
      expect(failed.events.filter((event) => !event.startsWith('tempo'))).toEqual([]);
      expect(failed.events.at(-1) ?? 'tempo 120').toBe('tempo 120');

      // And the corrected build afterwards does all of it.
      const fixed = await play([base, step, corrected]);
      const reference = await direct;
      expectSame(fixed, reference);
      expect(summary(fixed.outcomes[2])).toEqual(summary(reference.outcomes[1]));
      expect(fixed.events.slice(fixed.events.lastIndexOf('tempo 120') + 1)).toEqual(
        reference.events,
      );
    });
  }

  it("reports what a node's own code throws once the build is under way, and does the rest", async () => {
    // A method of a node that was already there runs when the build succeeds. Nothing can check
    // beforehand whether it will throw, so this is the one thing that is reported and not refused.
    const { direct } = references();
    const played = await play([
      base,
      changed((__, fired) => {
        goodSpare(__, fired);
        loose(__('#spareunit')).call!('boom');
      }),
    ]);
    const result = summary(played.outcomes[1]);
    expect(result.errors.map((error) => [error.code, error.message])).toEqual([
      ['build-failed', 'boom'],
    ]);
    expectSame(played, await direct);
  });

  it('holds back what the builder asks of kept nodes until it has finished', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('track');
    await scope.build((__) => void __().sine({ id: 'osc', frequency: 200 }).to('main'));
    const param = scope.select('#osc').param('frequency');
    let during: unknown;
    await scope.build((__) => {
      __().sine({ id: 'osc', frequency: 200 }).to('main');
      __('#osc').set({ frequency: 300 });
      during = param.value;
    });
    expect(during).toBe(200);
    expect(param.value).toBe(300);
  });

  it('undoes a build of another scope made inside a builder that then fails', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('a');
    const other = engine.scope('b');
    const patch = (frequency: number) => (__: ScopeApi) =>
      void __().sine({ id: 'osc', frequency }).gain({ id: 'level' }).to('main');
    await other.build(patch(200));
    const before = other.describe();
    const nodes = other.select('*').nodes;
    await expect(
      scope.build((__) => {
        __().sine({ id: 'mine' }).to('main');
        void other.build((inner) => {
          patch(900)(inner);
          inner().saw({ id: 'added' }).to('main');
        });
        throw new Error('later');
      }),
    ).rejects.toMatchObject({ message: 'later' });
    expect(other.describe()).toEqual(before);
    expect(other.select('*').nodes).toEqual(nodes);
    expect(scope.select('*')).toHaveLength(0);

    // When the outer builder succeeds, so does the inner build, and its result is filled in.
    let inner: Promise<ApplyResult> | null = null;
    await scope.build((__) => {
      __().sine({ id: 'mine' }).to('main');
      inner = other.build(patch(900));
    });
    expect(other.select('#osc').param('frequency').value).toBe(900);
    expect(ids((await inner!).updated)).toEqual(['osc']);
  });

  it('carries on when a build of another scope inside the builder is refused', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('a');
    const other = engine.scope('b');
    await other.build((__) => void __().sine({ id: 'osc', frequency: 200 }).to('main'));
    const before = other.describe();
    let refused: unknown;
    await scope.build((__) => {
      __().sine({ id: 'mine', frequency: 300 }).to('main');
      other
        .build((inner) => {
          inner().sine({ id: 'osc', frequency: 900 }).to('main');
          inner('#osc').set({ frequency: 950 });
          inner('#osc').set({ frequency: 'loud' as never });
        })
        .catch((error: unknown) => (refused = error));
      __('#mine').set({ frequency: 400 });
    });
    expect(refused).toMatchObject({ code: 'invalid-param', nodeId: 'osc' });
    expect(other.describe()).toEqual(before);
    expect(scope.select('#mine').param('frequency').value).toBe(400);
  });
});

describe('apply stays per node', () => {
  async function applied(engine: Engine, scope: Scope) {
    const graph = scope.describe();
    const result = await scope.apply({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === 'osc'
          ? { ...node, params: { ...node.params, frequency: 'loud', detune: 50 } }
          : node.id === 'level'
            ? { ...node, params: { gain: 0.25 } }
            : node,
      ),
    });
    void engine;
    return result;
  }

  it('leaves a node it cannot bring to the values asked as it was, and applies the others', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('track');
    scope.chain().sine({ id: 'osc', frequency: 200 }).gain({ id: 'level', gain: 0.5 }).to('main');
    const result = await applied(engine, scope);
    expect(result.errors.map((error) => [error.code, error.nodeId])).toEqual([
      ['invalid-param', 'osc'],
    ]);
    expect(result.errors[0]!.message).toMatch(/"frequency" on sine "osc"/);
    expect(scope.select('#level').param('gain').value).toBe(0.25);
    // None of the bad node's values moved, not only the one that was wrong.
    expect(scope.select('#osc').param('frequency').value).toBe(200);
    expect(scope.select('#osc').param('detune').value).toBe(0);
    expect(ids(scope.select('*'))).toEqual(['osc', 'level']);
    expect(scope.describe().edges).toHaveLength(2);
  });
});
