import { describe, expect, it } from 'vitest';
import type { Command, HostMessage, RemoteError, RemoteMessage } from '../../src';
import { createRemote, linkRemote } from '../../src/remote';
import type { LinkOptions, Remote } from '../../src/remote';
import { click, offlineEngine, ones, valueAt } from '../core/setup';

/**
 * A host scope and a remote wired straight to each other. Every message is passed through
 * `structuredClone`, as `postMessage` would, so anything that is not plain data fails here.
 */
async function linked(seconds: number, allow?: LinkOptions['allow']) {
  const engine = await offlineEngine(seconds);
  engine.buffers.add('ones', ones(seconds));
  engine.buffers.add('click', click());
  const scope = engine.scope('script');
  const sent: RemoteMessage[] = [];
  const received: HostMessage[] = [];
  const holder: { remote?: Remote } = {};
  const link = linkRemote(scope, {
    send: (message) => {
      received.push(message);
      holder.remote?.receive(structuredClone(message));
    },
    ...(allow ? { allow } : {}),
  });
  const remote = createRemote({
    ...structuredClone(link.state()),
    send: (message) => {
      sent.push(message);
      link.receive(structuredClone(message));
    },
  });
  holder.remote = remote;
  const errors: RemoteError[] = [];
  remote.on('error', (error) => errors.push(error));
  return { engine, scope, link, remote, __: remote.__, sent, received, errors };
}

const ops = (message: RemoteMessage | undefined): string[] =>
  message?.type === 'commands' ? message.commands.map((command) => command.op) : [];

describe('remote graph building', () => {
  it('builds on the host what a chain describes in the sandbox', async () => {
    const { engine, scope, remote, __ } = await linked(0.2);
    __().sampler({ id: 'dc', buffer: 'ones' }).gain(0.5).to('main');
    __('#dc').trigger();
    remote.flush();
    expect(scope.select('*').nodes.map((node) => node.id)).toEqual(['dc', 'gain-0']);
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(0.5, 6);
  });

  it('sends one message per turn of the event loop', async () => {
    const { sent, __ } = await linked(0.1);
    __().sampler({ id: 'dc', buffer: 'ones' }).gain(0.5).to('main');
    __('#dc').trigger();
    __('gain').gain(0.25);
    expect(sent).toHaveLength(0);
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(ops(sent[0])).toEqual(['apply', 'trigger', 'set']);
  });

  it('answers reads from its mirror', async () => {
    const { scope, remote, __ } = await linked(0.1);
    __().sine({ id: 'osc' }).gain({ id: 'g', class: 'wet', gain: 0.5 }).to('main');
    expect(__('#osc').param('frequency').value).toBe(__('#osc').param('frequency').meta.default);
    expect(__('.wet').param('gain').value).toBe(0.5);
    __('#g').gain(0.25);
    expect(__('#g').param('gain').value).toBe(0.25);
    expect(__('*')).toHaveLength(2);
    expect(
      __('#g')
        .first()
        ?.inputs.map((edge) => (edge.from as { id: string }).id),
    ).toEqual(['osc']);
    remote.flush();
    expect(scope.select('#g').param('gain').value).toBe(0.25);
    expect(remote.describe()).toEqual(scope.describe());
  });

  it('routes through a bus and keeps that routing across later changes', async () => {
    const { engine, scope, remote, __ } = await linked(0.2);
    __.bus('fx').chain().gain({ id: 'wet', gain: 0.5 }).to('main');
    __().sampler({ id: 'dc', buffer: 'ones' }).to('fx');
    remote.flush();
    __().gain({ id: 'later' });
    __('#dc').trigger();
    remote.flush();
    expect(scope.describe().edges).toContainEqual({ from: { bus: 'fx' }, to: { node: 'wet' } });
    // The bus feeds main itself, and its chain adds half as much again.
    expect(valueAt(await engine.render(), 0.1)).toBeCloseTo(1.5, 6);
  });

  it('reaches inside a macro by selector, which the host resolves', async () => {
    const { scope, remote, __ } = await linked(0.1);
    __().monosynth({ id: 'syn' }).to('main');
    __('#syn').select('lowpass').set({ frequency: 321 });
    __('#syn lowpass').set({ q: 3 });
    remote.flush();
    const filter = scope.select('#syn lowpass');
    expect(filter).toHaveLength(1);
    expect(filter.param('frequency').value).toBe(321);
    expect(filter.param('q').value).toBe(3);
  });

  it('throws in the sandbox for mistakes it can see', async () => {
    const { __ } = await linked(0.1);
    expect(() => (__() as unknown as { nope(): void }).nope()).toThrow();
    __().sine({ id: 'a' });
    expect(() => __().sine({ id: 'a' })).toThrow(/already a node/);
    expect(() => __('##')).toThrow(/selector/i);
    expect(() => __().sine().connect('#missing')).toThrow(/Nothing matches/);
  });
});

describe('remote sequences', () => {
  it('runs the callback in the sandbox and lands its commands on the event', async () => {
    const { engine, remote, __ } = await linked(1);
    const seen: number[][] = [];
    __().sampler({ id: 'hit', buffer: 'click' }).to('main');
    remote.transport.sequence('hits', { steps: [1, 0, 2], step: '1/8' }, (ev) => {
      seen.push([ev.index, ev.value, ev.beat]);
      if (ev.value) __('#hit').trigger({ velocity: ev.value / 2 });
      expect(ev.at(0.5)).toBeCloseTo(ev.time + ev.duration / 2, 9);
    });
    remote.flush();
    engine.transport.start();
    const audio = (await engine.render()).getChannelData(0);
    expect(seen.slice(0, 4)).toEqual([
      [0, 1, 0],
      [1, 0, 0.5],
      [2, 2, 1],
      [0, 1, 1.5],
    ]);
    // 120 bpm at 48 kHz: an eighth note is 12000 samples.
    expect(audio[0]).toBeCloseTo(0.5, 6);
    expect(audio[12000]).toBe(0);
    expect(audio[24000]).toBeCloseTo(1, 6);
    expect(audio[36000]).toBeCloseTo(0.5, 6);
    expect(audio[36001]).toBe(0);
  });

  it('edits steps, mutes and stops', async () => {
    const { engine, scope, remote } = await linked(1);
    const values: number[] = [];
    const sequence = remote.transport.steps('s', 'x.', (_index, value) => values.push(value));
    sequence.setStep(1, 5);
    expect(sequence.steps).toEqual([1, 5]);
    remote.flush();
    expect(scope.transport.get('s')?.steps).toEqual([1, 5]);
    engine.transport.start();
    await engine.render();
    expect(values.slice(0, 4)).toEqual([1, 5, 1, 5]);

    sequence.stop();
    remote.flush();
    expect(scope.transport.get('s')).toBeUndefined();
    expect(remote.transport.get('s')).toBeUndefined();
  });

  it('reports a callback that throws without stopping the sequence', async () => {
    const { engine, remote, errors } = await linked(0.6);
    let calls = 0;
    remote.transport.sequence('s', { steps: 1, step: '1/4' }, () => {
      calls++;
      throw new Error('oops');
    });
    remote.flush();
    engine.transport.start();
    await engine.render();
    expect(calls).toBe(2);
    expect(errors).toEqual([
      { code: 'callback', message: 'oops' },
      { code: 'callback', message: 'oops' },
    ]);
  });

  it('reads and sets tempo', async () => {
    const { engine, remote } = await linked(0.1);
    expect(remote.transport.bpm).toBe(120);
    expect(remote.transport.seconds('1/4')).toBeCloseTo(0.5, 9);
    remote.transport.bpm = 90;
    remote.flush();
    expect(engine.transport.bpm).toBe(90);
    engine.transport.bpm = 150;
    expect(remote.transport.bpm).toBe(150);
  });
});

describe('remote build', () => {
  it('rebuilds in place: the host keeps unchanged nodes and drops undeclared sequences', async () => {
    const { scope, remote, sent } = await linked(0.1);
    const program = (cutoff: number, withB: boolean) => () =>
      remote.build((__) => {
        __().saw({ id: 'osc' }).lowpass(cutoff).gain(0.5).to('main');
        __.transport.sequence('a', { steps: 'x.' }, () => undefined);
        if (withB) __.transport.sequence('b', { steps: 'x.' }, () => undefined);
      });
    program(500, true)();
    expect(sent).toHaveLength(1);
    const nodes = scope.select('*').nodes;
    const a = scope.transport.get('a');
    expect(scope.transport.get('b')).toBeDefined();

    program(900, false)();
    expect(scope.select('*').nodes).toEqual(nodes);
    expect(scope.select('lowpass').param('frequency').value).toBe(900);
    expect(scope.transport.get('a')).toBe(a);
    expect(scope.transport.get('b')).toBeUndefined();
    expect(remote.transport.get('b')).toBeUndefined();
  });

  it('sends nothing and keeps its mirror when the builder throws', async () => {
    const { scope, remote, sent } = await linked(0.1);
    remote.build((__) => {
      __().sine({ id: 'osc' }).to('main');
      __.transport.sequence('a', { steps: 'x.' }, () => undefined);
    });
    const before = remote.describe();
    const sequence = remote.transport.get('a');
    sent.length = 0;
    expect(() =>
      remote.build((__) => {
        __().saw({ id: 'other' }).to('main');
        __.transport.sequence('a', { steps: 'xx' }, () => undefined);
        __('#other').trigger();
        throw new Error('half-typed');
      }),
    ).toThrow('half-typed');
    await Promise.resolve();
    expect(sent).toEqual([]);
    expect(remote.describe()).toEqual(before);
    expect(remote.transport.get('a')).toBe(sequence);
    expect(scope.select('*').nodes.map((node) => node.id)).toEqual(['osc']);
  });
});

describe('the link', () => {
  it('tells the remote about values and nodes changed on the host', async () => {
    const { scope, remote, __ } = await linked(0.1);
    __().sine({ id: 'osc' }).gain({ id: 'g', gain: 0.5 }).to('main');
    remote.flush();
    const changes: unknown[] = [];
    __('#g')
      .param('gain')
      .on('change', (change) => changes.push(change.value));

    scope.select('#g').set({ gain: 0.1 });
    await Promise.resolve();
    expect(__('#g').param('gain').value).toBe(0.1);
    expect(changes).toEqual([0.1]);

    scope.chain().gain({ id: 'from-host' });
    await Promise.resolve();
    expect(__('#from-host')).toHaveLength(1);
  });

  it('does not echo the remote’s own changes back', async () => {
    const { remote, received, __ } = await linked(0.1);
    __().sine({ id: 'osc' }).gain({ id: 'g' }).to('main');
    __('#g').gain(0.3);
    remote.flush();
    await Promise.resolve();
    expect(received).toEqual([]);
  });

  it('sends errors back to the remote', async () => {
    const { remote, errors, __ } = await linked(0.1);
    __().sine({ id: 'osc' }).to('nowhere');
    __('#osc').call('nope');
    remote.flush();
    expect(errors.map((error) => error.code)).toEqual(['missing-target', 'invalid-command']);
    expect(errors[0]?.message).toMatch(/no bus called "nowhere"/);
  });

  it('keeps commands inside the linked scope', async () => {
    const { engine, link, errors, __, remote } = await linked(0.1);
    engine.chain().gain({ id: 'outside', gain: 1 }).to('main');
    __.bus('main').gain.set(0);
    remote.flush();
    link.receive({
      type: 'commands',
      commands: [
        { op: 'set', target: '#outside', at: 0, values: { gain: 0 } },
        { op: 'set', target: { ids: ['outside'] }, at: 0, values: { gain: 0 } },
        { op: 'dispose', target: '*' },
        {
          op: 'apply',
          graph: { nodes: [], edges: [{ from: { bus: 'main' }, to: { bus: 'main' } }] },
        },
        null as unknown as Command,
        { op: 'launch' } as unknown as Command,
      ],
    });
    expect(engine.bus('main').gain.value).toBe(1);
    expect(engine.select('#outside').param('gain').value).toBe(1);
    expect(errors.map((error) => error.code)).toEqual([
      'invalid-command',
      'missing-target',
      'invalid-command',
      'invalid-command',
    ]);
  });

  it('lets the host refuse commands', async () => {
    const refused: string[] = [];
    const { engine, remote, scope, __ } = await linked(0.1, (command) => {
      if (command.op !== 'transport' && command.op !== 'loadBuffer') return true;
      refused.push(command.op);
      return false;
    });
    remote.transport.bpm = 300;
    __().sine({ id: 'osc' }).to('main');
    remote.flush();
    expect(refused).toEqual(['transport']);
    expect(engine.transport.bpm).toBe(120);
    expect(scope.select('#osc')).toHaveLength(1);
  });

  it('removes the remote’s sequences and stops forwarding when disposed', async () => {
    const { scope, link, remote, received, __ } = await linked(0.1);
    __().gain({ id: 'g' });
    remote.transport.sequence('a', { steps: 'x' }, () => undefined);
    remote.flush();
    expect(scope.transport.get('a')).toBeDefined();
    link.dispose();
    expect(scope.transport.get('a')).toBeUndefined();
    scope.select('#g').set({ gain: 0.2 });
    await Promise.resolve();
    __('#g').gain(0.9);
    remote.flush();
    expect(received).toEqual([]);
    expect(scope.select('#g').param('gain').value).toBe(0.2);
  });
});
