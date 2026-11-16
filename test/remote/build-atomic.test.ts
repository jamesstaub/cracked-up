import { describe, expect, it } from 'vitest';
import { defineNode } from '../../src';
import type { HostMessage, RemoteError, RemoteMessage, ScopeApi } from '../../src';
import { createRemote, linkRemote } from '../../src/remote';
import type { Remote } from '../../src/remote';
import { offlineEngine } from '../core/setup';

/**
 * `remote.build()` happens whole or not at all, like `scope.build()`. A bad value is refused in the
 * sandbox and nothing is sent. What only the host can tell is refused there: it applies none of the
 * build and the remote goes back to what it held. Either way the host then renders, describes
 * itself and schedules exactly as if the build had never been run.
 */

const SECONDS = 0.5;

/** A host node type with a parameter of each kind and a creation option that makes its build fail. */
const unit = defineNode({
  type: 'unit',
  category: 'utility',
  params: {
    level: { default: 1, min: 0, max: 2 },
    mode: { kind: 'choice', choices: ['soft', 'hard'], default: 'soft', rate: 'control' },
    on: { kind: 'boolean', default: true, rate: 'control' },
    size: { default: 1, min: 0, max: 2, rate: 'control' },
  },
  build(context, init) {
    if (init['explode'] === true) throw new Error('kaboom');
    const level = new GainNode(context.audio);
    const mode = new GainNode(context.audio);
    level.connect(mode);
    return {
      input: level,
      output: mode,
      params: {
        level: level.gain,
        mode: (value, at) => mode.gain.setValueAtTime(value === 'hard' ? 0.5 : 1, at),
        on: () => undefined,
        size: () => undefined,
      },
      methods: { duck: (_args, at) => mode.gain.setValueAtTime(0.25, at) },
    };
  },
});

type Loose = Record<string, (...args: unknown[]) => Loose> & { to(bus: string): Loose };
const loose = (value: unknown) => value as Loose;

type Step = (__: ScopeApi, fired: string[]) => void;

const spare =
  (osc: object, fx: object, macro: object): Step =>
  (__) => {
    loose(__().sine({ id: 'spare', ...osc })).unit!({ id: 'spareunit', ...fx }).pad!({
      id: 'sparepad',
      ...macro,
    }).gain!({ id: 'sparelevel', gain: 0.05 }).to('main');
  };

const base: Step = (__, fired) => {
  loose(__().saw({ id: 'osc', frequency: 110 }).lowpass({ id: 'filter', frequency: 800 })).unit!({
    id: 'unit',
    level: 0.8,
  }).gain!({ id: 'level', gain: 0.5 }).to('main');
  __.bus('fx').insert().gain({ id: 'trim', gain: 0.5 });
  __().sine({ id: 'tone', frequency: 330 }).gain({ id: 'send', gain: 0.2 }).to('fx');
  spare({ frequency: 200 }, {}, {})(__, fired);
  __.transport.sequence('seq', { steps: 'x.x.', step: '1/16' }, (event) => {
    fired.push(`old:${event.index}=${event.value}@${event.time.toFixed(6)}`);
    __('#send').set({ gain: event.value > 0 ? 0.3 : 0.1 });
  });
};

const goodSpare = spare({ frequency: 300 }, { mode: 'hard', level: 0.5 }, { amount: 0.8 });

/** Changes a bit of everything, with `part` in the middle. */
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
    __.transport.sequence('seq', { steps: 'xxxx', step: '1/8' }, (event) => {
      fired.push(`new:${event.index}=${event.value}@${event.time.toFixed(6)}`);
    });
    __.transport.sequence('more', { steps: 'x', step: '1/4' }, (event) => {
      fired.push(`more@${event.time.toFixed(6)}`);
    });
    __.transport.every('1/4', (event) => fired.push(`every@${event.time.toFixed(6)}`));
    part(__, fired);
    __('#send').set({ gain: 0.05 });
  };

const corrected = changed(goodSpare);
const withBad = (bad: Step): Step =>
  changed((__, fired) => {
    goodSpare(__, fired);
    bad(__, fired);
  });

async function play(steps: readonly Step[]) {
  const engine = await offlineEngine(SECONDS);
  engine.registry.register(unit);
  const scope = engine.scope('script');
  const sent: RemoteMessage[] = [];
  const holder: { remote?: Remote } = {};
  // Every message goes through `structuredClone`, as `postMessage` would send it.
  const link = linkRemote(scope, {
    send: (message: HostMessage) => holder.remote?.receive(structuredClone(message)),
  });
  const remote = createRemote({
    ...structuredClone(link.state()),
    send: (message) => {
      sent.push(message);
      link.receive(structuredClone(message));
    },
  });
  holder.remote = remote;
  remote.define({
    type: 'pad',
    params: {
      amount: { default: 0.5, min: 0, max: 1, drives: [{ select: '#body', param: 'gain' }] },
    },
    build(__) {
      __.bus('in').chain().gain({ id: 'body' }).to('out');
    },
  });
  remote.flush();

  const fired: string[] = [];
  const events: string[] = [];
  let errors: RemoteError[] = [];
  remote.on('error', (error) => errors.push(error));
  /** For each step: what it threw in the sandbox, what the host reported, and what was sent. */
  const outcomes: { thrown: unknown; errors: RemoteError[]; messages: number }[] = [];
  for (const [index, step] of steps.entries()) {
    errors = [];
    sent.length = 0;
    let thrown: unknown = null;
    try {
      remote.build((__) => step(__, fired));
    } catch (error) {
      thrown = error;
    }
    outcomes.push({ thrown, errors, messages: sent.length });
    if (index > 0) continue;
    scope.on('param:changed', (change) =>
      events.push(`${change.param.node.id}.${change.param.name}=${String(change.value)}`),
    );
    scope.on('node:added', (node) => events.push(`+${node.id}`));
    scope.on('node:removed', (id) => events.push(`-${id}`));
  }
  const state = {
    graph: scope.describe(),
    buses: scope.snapshot().buses,
    bypassed: scope.select('*').nodes.map((node) => `${node.id}:${String(node.bypass)}`),
    inside: scope.select('#sparepad gain').nodes.map((node) => node.param('gain').value),
    bpm: engine.transport.bpm,
    sequences: scope.transport.sequences.map((sequence) => ({
      name: sequence.name,
      steps: [...sequence.steps],
      options: sequence.options,
    })),
    // The sandbox's own account of things.
    mirror: remote.describe(),
    mirrorBpm: remote.transport.bpm,
    mirrorSteps: remote.transport.get('seq')?.steps,
    mirrorHasMore: remote.transport.get('more') !== undefined,
  };
  const told = [...events];
  engine.transport.start();
  const audio = (await engine.render()).getChannelData(0).slice();
  return { audio, state, fired, events: told, outcomes };
}

type Played = Awaited<ReturnType<typeof play>>;

/** The first sample at which two renders differ by more than the order of a sum can explain, or -1. */
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

let untouched: Promise<Played> | null = null;
let direct: Promise<Played> | null = null;
const references = () => ({
  untouched: (untouched ??= play([base])),
  direct: (direct ??= play([base, corrected])),
});

interface Refusal {
  code: RemoteError['code'];
  message: RegExp;
  nodeId?: string;
}

/** Refused in the sandbox: `build` throws and nothing is sent. */
const local: [string, Step, Refusal][] = [
  [
    'a kept node declared with a value of the wrong kind',
    changed(spare({ frequency: 'loud' }, { mode: 'hard' }, {})),
    {
      code: 'invalid-param',
      nodeId: 'spare',
      message: /"frequency" on sine "spare" needs a finite/,
    },
  ],
  [
    'a kept node declared with a choice it does not have',
    changed(spare({ frequency: 300 }, { mode: 'medium' }, {})),
    {
      code: 'invalid-param',
      nodeId: 'spareunit',
      message: /"mode" on unit "spareunit" must be one/,
    },
  ],
  [
    'a kept instance of a macro defined in the sandbox declared with a bad value',
    changed(spare({ frequency: 300 }, { mode: 'hard' }, { amount: 'lots' })),
    { code: 'invalid-param', nodeId: 'sparepad', message: /"amount" on pad "sparepad"/ },
  ],
  [
    'a new node with a bad value',
    withBad((__) => void __().lowpass({ id: 'fresh', frequency: Number.NaN })),
    { code: 'invalid-param', nodeId: 'fresh', message: /"frequency" on lowpass "fresh"/ },
  ],
  [
    'set() with a value of the wrong kind',
    withBad((__) => void __('#sparelevel').set({ gain: 'loud' as never })),
    { code: 'invalid-param', nodeId: 'sparelevel', message: /"gain" on gain "sparelevel"/ },
  ],
  [
    'a shortcut setter with a bad value',
    withBad((__) => void loose(__('#spareunit')).on!('yes')),
    { code: 'invalid-param', nodeId: 'spareunit', message: /"on" on unit "spareunit" needs true/ },
  ],
  [
    'a bad value set through the parameter itself',
    withBad((__) => void __('#sparelevel').param('gain').set('loud')),
    { code: 'invalid-param', nodeId: 'sparelevel', message: /"gain" on gain "sparelevel"/ },
  ],
  [
    'a set with a glide that cannot be',
    withBad((__) => void __('#sparelevel').set({ gain: 0.1 }, { glide: -1 })),
    { code: 'invalid-param', nodeId: 'sparelevel', message: /needs a glide of 0 or more seconds/ },
  ],
  [
    'a ramp to something that is not a number',
    withBad((__) => void __('#sparelevel').ramp('gain', Number.NaN, { duration: 0.1 })),
    { code: 'invalid-param', nodeId: 'sparelevel', message: /"gain" on gain "sparelevel"/ },
  ],
  [
    'a ramp of a parameter that is not a number',
    withBad((__) => void __('#spareunit').ramp('mode', 1, { duration: 0.1 })),
    { code: 'invalid-param', nodeId: 'spareunit', message: /"mode" on unit "spareunit" cannot be/ },
  ],
  [
    'an offset that is not a number',
    withBad((__) => void __('#sparelevel').offset('gain', Number.NaN)),
    { code: 'invalid-param', nodeId: 'sparelevel', message: /offset must be a finite number/ },
  ],
  [
    'a connection to a node that does not exist',
    withBad((__) => void __('#spare').connect('#ghost')),
    { code: 'missing-target', message: /Nothing matches "#ghost"/ },
  ],
  [
    'a sequence with no steps',
    withBad((__) => void __.transport.sequence('seq', { steps: 0 }, () => undefined)),
    { code: 'build-failed', message: /at least one step/ },
  ],
  [
    'a builder that throws',
    withBad(() => {
      throw new Error('half-typed');
    }),
    { code: 'build-failed', message: /^half-typed$/ },
  ],
];

/** Refused by the host: `build` returns, the errors arrive, and the host applied none of it. */
const remote: [string, Step, Refusal][] = [
  [
    'a chain sent to a bus that does not exist',
    withBad((__) => void __('#sparelevel').to('nowhere')),
    { code: 'missing-target', message: /no bus called "nowhere"/ },
  ],
  [
    'a bus routed to a bus that does not exist',
    withBad((__) => void __.bus('fx').to('nowhere')),
    { code: 'missing-target', message: /no bus called "nowhere"/ },
  ],
  [
    'an insert that has no input',
    withBad((__) => void __.bus('fx').sine({ id: 'whistle' })),
    { code: 'missing-target', nodeId: 'whistle', message: /cannot be an insert on bus "fx"/ },
  ],
  [
    'an insert the host cannot build',
    withBad((__) => void loose(__.bus('fx').insert()).unit!({ id: 'broken', explode: true })),
    { code: 'build-failed', nodeId: 'broken', message: /Could not build unit "broken": kaboom/ },
  ],
  [
    'a kept node whose creation option changed, so it is replaced, and the replacement fails',
    changed(spare({ frequency: 300 }, { explode: true }, {})),
    { code: 'build-failed', nodeId: 'spareunit', message: /Could not build unit "spareunit"/ },
  ],
  [
    'a ramp of a parameter that cannot be ramped',
    withBad((__) => void __('#spareunit').ramp('size' as never, 1, { duration: 0.1 })),
    {
      code: 'invalid-param',
      nodeId: 'spareunit',
      message: /"size" on unit "spareunit" cannot be ramped/,
    },
  ],
  [
    'a method the node does not have',
    withBad((__) => void __('#spareunit').call('nope')),
    { code: 'invalid-command', nodeId: 'spareunit', message: /no method called "nope"/ },
  ],
  [
    'a modulator aimed at a parameter that cannot be modulated',
    withBad((__) => void __('#spare').chain().modulate('#spareunit', 'mode')),
    { code: 'invalid-param', nodeId: 'spareunit', message: /cannot be modulated/ },
  ],
  [
    'a sequence with options that cannot be',
    withBad(
      (__) =>
        void __.transport.sequence(
          'seq',
          { steps: 'x.', step: '1/8', span: '1/1' },
          () => undefined,
        ),
    ),
    { code: 'invalid-command', message: /either "step" or "span"/ },
  ],
  [
    'a tempo that cannot be',
    withBad((__) => void (__.transport.bpm = -1)),
    { code: 'invalid-command', message: /bpm must be a number above 0/ },
  ],
];

describe('remote build is all or nothing', () => {
  it('the corrected build of these tests does change everything it touches', async () => {
    const { untouched, direct } = references();
    const [before, after] = await Promise.all([untouched, direct]);
    expect(firstDifference(before.audio, after.audio)).not.toBe(-1);
    expect(after.state).not.toEqual(before.state);
    expect(after.state.bpm).toBe(90);
    expect(after.state.inside).toEqual([0.8]);
    expect(after.fired.some((entry) => entry.startsWith('new:'))).toBe(true);
    expect(after.fired.some((entry) => entry.startsWith('old:'))).toBe(false);
    expect(after.outcomes[1]).toEqual({ thrown: null, errors: [], messages: 1 });
    expect(after.events).toContain('level.gain=0.9');
    expect(after.events).toContain('+extra');
  });

  for (const [name, step, refusal] of local) {
    it(`refuses the whole build in the sandbox: ${name}`, async () => {
      const failed = await play([base, step]);
      const outcome = failed.outcomes[1]!;
      expect(outcome.thrown).toMatchObject({
        message: expect.stringMatching(refusal.message) as unknown,
        ...(refusal.code === 'build-failed' ? {} : { code: refusal.code }),
        ...(refusal.nodeId === undefined ? {} : { nodeId: refusal.nodeId }),
      });
      // Nothing left the sandbox.
      expect(outcome.messages).toBe(0);
      expect(outcome.errors).toEqual([]);

      const { untouched, direct } = references();
      expectSame(failed, await untouched);
      expect(failed.events).toEqual([]);

      const fixed = await play([base, step, corrected]);
      const reference = await direct;
      expectSame(fixed, reference);
      expect(fixed.events).toEqual(reference.events);
      expect(fixed.outcomes[2]).toEqual({ thrown: null, errors: [], messages: 1 });
    });
  }

  for (const [name, step, refusal] of remote) {
    it(`refuses the whole build on the host: ${name}`, async () => {
      const failed = await play([base, step]);
      const outcome = failed.outcomes[1]!;
      expect(outcome.thrown).toBeNull();
      expect(outcome.messages).toBe(1);
      expect(outcome.errors.length).toBeGreaterThan(0);
      const error = outcome.errors[0]!;
      expect(error.code).toBe(refusal.code);
      expect(error.message).toMatch(refusal.message);
      if (refusal.nodeId !== undefined) expect(error.nodeId).toBe(refusal.nodeId);

      // The host is exactly as if the build had never arrived, and the sandbox agrees with it.
      const { untouched, direct } = references();
      expectSame(failed, await untouched);
      expect(failed.events).toEqual([]);

      const fixed = await play([base, step, corrected]);
      const reference = await direct;
      expectSame(fixed, reference);
      expect(fixed.events).toEqual(reference.events);
      expect(fixed.outcomes[2]).toEqual({ thrown: null, errors: [], messages: 1 });
    });
  }

  it('applies commands sent outside a build one by one, as before', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('script');
    const holder: { remote?: Remote } = {};
    const link = linkRemote(scope, {
      send: (message) => holder.remote?.receive(structuredClone(message)),
    });
    const remote = createRemote({
      ...structuredClone(link.state()),
      send: (message) => link.receive(structuredClone(message)),
    });
    holder.remote = remote;
    const errors: RemoteError[] = [];
    remote.on('error', (error) => errors.push(error));
    remote.__().sine({ id: 'osc', frequency: 300 }).gain({ id: 'level', gain: 0.5 }).to('nowhere');
    remote.__('#level').set({ gain: 0.25 });
    remote.flush();
    expect(errors.map((error) => error.code)).toEqual(['missing-target']);
    expect(scope.select('*').nodes.map((node) => node.id)).toEqual(['osc', 'level']);
    expect(scope.select('#level').param('gain').value).toBe(0.25);
  });
});
