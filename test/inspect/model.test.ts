import { describe, expect, it } from 'vitest';
import type { Engine, ScopeApi } from '../../src';
import {
  buildModel,
  busDetail,
  busKey,
  nodeDetail,
  nodeKey,
  outputKey,
  readScope,
  scopeKey,
  signature,
  triggerOptions,
  walk,
} from '../../src/inspect/model';
import type { ScopeSource, ViewGraph } from '../../src/inspect/model';
import { offlineEngine, ones } from '../core/setup';

/** The kind of graph the demo page builds: drums on a bus, a bass with an lfo, a macro, a bypassed node. */
function patch(__: ScopeApi): void {
  __.bus('drums');
  __().sampler({ id: 'kick' }).to('drums');
  __().sampler({ id: 'snare', class: 'drum loud' }).gain(0.6).to('drums');
  __()
    .saw({ id: 'bass', gate: 'closed' })
    .lowpass({ id: 'filter', frequency: 600 })
    .overdrive({ id: 'drive', bypass: true })
    .tapedelay({ id: 'echo' })
    .to('main');
  __().lfo({ id: 'wobble', frequency: 0.4, depth: 350 }).modulate('#filter', 'frequency');
}

async function patched(): Promise<Engine> {
  const engine = await offlineEngine(0.1);
  await engine.scope('live').build(patch);
  return engine;
}

const find = (graph: ViewGraph, key: string) => graph.nodes.find((node) => node.key === key);
const edgeKeys = (graph: ViewGraph): string[] => graph.edges.map((edge) => edge.key).sort();

describe('buildModel from a live scope', () => {
  it('draws nodes with their type, id, classes, bypass and macro state', async () => {
    const engine = await patched();
    const model = buildModel(readScope(engine.scope('live')).source);
    expect(model.name).toBe('live');

    const snare = find(model, nodeKey('', 'snare'))!;
    expect(snare).toMatchObject({
      kind: 'node',
      type: 'sampler',
      id: 'snare',
      classes: ['drum', 'loud'],
      category: 'source',
      triggerable: true,
      bypassed: false,
      macro: false,
      autoId: false,
      signal: 'audio',
    });
    expect(find(model, nodeKey('', 'drive'))).toMatchObject({ bypassed: true });
    expect(find(model, nodeKey('', 'echo'))).toMatchObject({
      macro: true,
      expandable: true,
      children: null,
    });
    // The gain after the snare was given no id, so the one it has was generated.
    expect(find(model, nodeKey('', 'gain-0'))).toMatchObject({ autoId: true });
  });

  it('draws buses as nodes of their own, and marks one that belongs to an outer scope', async () => {
    const engine = await patched();
    const model = buildModel(readScope(engine.scope('live')).source);
    expect(find(model, busKey('', 'drums'))).toMatchObject({ kind: 'bus', external: false });
    // `main` is the engine's; the live scope only sends to it.
    expect(find(model, busKey('', 'main'))).toMatchObject({ kind: 'bus', external: true });
    expect(find(model, outputKey(''))).toBeUndefined();
    expect(edgeKeys(model)).toContain(`${nodeKey('', 'kick')}>${busKey('', 'drums')}`);
    // Where the bus itself goes.
    const route = model.edges.find((edge) => edge.from === busKey('', 'drums'))!;
    expect(route).toMatchObject({ to: busKey('', 'main'), kind: 'route', param: null });
  });

  it('draws a modulation edge to the parameter, and its source as a control signal', async () => {
    const engine = await patched();
    const model = buildModel(readScope(engine.scope('live')).source);
    const edge = model.edges.find((item) => item.from === nodeKey('', 'wobble'))!;
    expect(edge).toMatchObject({
      to: nodeKey('', 'filter'),
      kind: 'modulation',
      param: 'frequency',
    });
    expect(find(model, nodeKey('', 'wobble'))!.signal).toBe('control');
    expect(find(model, nodeKey('', 'filter'))!.signal).toBe('audio');
    expect(model.edges.filter((item) => item.kind === 'modulation')).toHaveLength(1);
  });

  it('shows the root with its output, and a child scope opened in place', async () => {
    const engine = await patched();
    const reading = readScope(engine.root);
    const model = buildModel(reading.source);
    expect(find(model, busKey('', 'main'))).toMatchObject({ kind: 'bus', external: false });
    expect(find(model, outputKey(''))).toMatchObject({ kind: 'output' });
    expect(edgeKeys(model)).toContain(`${busKey('', 'main')}>${outputKey('')}`);

    const live = find(model, scopeKey('', 'live'))!;
    expect(live).toMatchObject({ kind: 'scope', id: 'live', expandable: true });
    // The scope as a whole is linked to the outer bus its nodes send to.
    expect(model.edges.find((edge) => edge.from === live.key)).toMatchObject({
      to: busKey('', 'main'),
      kind: 'link',
    });
    // Inside it, keys carry the scope's key as a prefix, so they cannot collide with the root's.
    expect(live.children!.path).toBe(live.key);
    expect(find(live.children!, nodeKey(live.key, 'kick'))).toBeDefined();
    expect(reading.handles.get(nodeKey(live.key, 'kick'))!.node!.id).toBe('kick');
    expect(reading.handles.get(live.key)!.scope).toBe(engine.scope('live'));
    expect(reading.scopes).toEqual([engine.root, engine.scope('live')]);
  });

  it('closes a child scope and opens a macro when asked to', async () => {
    const engine = await patched();
    const liveKey = scopeKey('', 'live');
    const closed = buildModel(readScope(engine.root, () => false).source, () => false);
    expect(find(closed, liveKey)!.children).toBeNull();
    expect([...walk(closed)].map((item) => item.node.key).sort()).toEqual(
      [busKey('', 'main'), outputKey(''), liveKey].sort(),
    );

    const open = (): boolean => true;
    const reading = readScope(engine.scope('live'), open);
    const model = buildModel(reading.source, open);
    const echo = find(model, nodeKey('', 'echo'))!;
    const inside = echo.children!;
    expect(inside.path).toBe(echo.key);
    // The macro's ports are buses of its private scope.
    expect(find(inside, busKey(echo.key, 'in'))).toMatchObject({ kind: 'bus', external: false });
    expect(find(inside, busKey(echo.key, 'out'))).toMatchObject({ kind: 'bus' });
    // The feedback loop is there as drawn edges, in both directions round the loop.
    const key = (id: string): string => nodeKey(echo.key, id);
    expect(edgeKeys(inside)).toEqual(
      expect.arrayContaining([
        `${busKey(echo.key, 'in')}>${key('record')}`,
        `${key('record')}>${key('tape')}`,
        `${key('tone')}>${key('feedback')}`,
        `${key('feedback')}>${key('record')}`,
        `${key('wow')}>${key('line')}:time`,
        `${key('glide')}>${key('line')}:time`,
      ]),
    );
    // Everything on the way to the delay time is a control signal: the constant, the two gains
    // that scale it, the smoother, and the two lfos. The delay line itself carries sound.
    const control = inside.nodes.filter((node) => node.signal === 'control').map((node) => node.id);
    expect(control.sort()).toEqual(
      ['flutter', 'glide', 'timeStart', 'timeTarget', 'unit', 'wow'].sort(),
    );
    expect(reading.handles.get(key('record'))!.node!.id).toBe('record');
    expect(reading.handles.get(busKey(echo.key, 'out'))!.bus!.name).toBe('out');
  });

  it('finds a chain continued from an outer bus, which describe() leaves out', async () => {
    const engine = await offlineEngine(0.1);
    const live = engine.scope('live');
    live.chain().sine({ id: 'tone' }).to('main');
    live.bus('main').chain().recorder({ id: 'tape' });
    expect(live.describe().edges).toEqual([{ from: 'tone', to: { bus: 'main' } }]);

    const reading = readScope(live);
    expect(reading.source.incoming).toEqual([{ bus: 'main', node: 'tape' }]);
    const model = buildModel(reading.source);
    expect(edgeKeys(model)).toContain(`${busKey('', 'main')}>${nodeKey('', 'tape')}`);
    // And from the root, the scope both sends to that bus and takes from it.
    const root = buildModel(readScope(engine.root, () => false).source, () => false);
    expect(edgeKeys(root)).toEqual(
      expect.arrayContaining([
        `${scopeKey('', 'live')}>${busKey('', 'main')}`,
        `${busKey('', 'main')}>${scopeKey('', 'live')}`,
      ]),
    );
  });

  it('reads nothing that changes the graph', async () => {
    const engine = await patched();
    const before = JSON.stringify([engine.root.snapshot(), engine.scope('live').snapshot()]);
    const open = (): boolean => true;
    buildModel(readScope(engine.root, open).source, open);
    expect(JSON.stringify([engine.root.snapshot(), engine.scope('live').snapshot()])).toBe(before);
  });
});

describe('buildModel from data', () => {
  const source = (over: Partial<ScopeSource> = {}): ScopeSource => ({
    snapshot: { name: 's', graph: { nodes: [], edges: [] }, buses: [] },
    root: false,
    inner: false,
    types: {},
    incoming: [],
    macros: {},
    children: [],
    ...over,
  });

  it('draws a type the registry does not know as a plain node', () => {
    const model = buildModel(
      source({
        snapshot: {
          name: 's',
          graph: { nodes: [{ id: 'x', type: 'mystery' }], edges: [] },
          buses: [],
        },
      }),
    );
    expect(model.nodes).toHaveLength(1);
    expect(model.nodes[0]).toMatchObject({ type: 'mystery', category: null, macro: false });
  });

  it('leaves out a macro port nothing is connected to, and edges to nodes that are not there', () => {
    const model = buildModel(
      source({
        inner: true,
        snapshot: {
          name: 'm',
          graph: {
            nodes: [{ id: 'osc', type: 'sine' }],
            edges: [
              { from: 'osc', to: { bus: 'out' } },
              { from: 'osc', to: { node: 'gone' } },
            ],
          },
          buses: [
            { name: 'in', to: null, gain: 1 },
            { name: 'out', to: null, gain: 1 },
          ],
        },
      }),
    );
    expect(model.nodes.map((node) => node.key).sort()).toEqual(
      [nodeKey('', 'osc'), busKey('', 'out')].sort(),
    );
    expect(model.edges).toHaveLength(1);
  });

  it('treats what only feeds control nodes as control, back along the chain', () => {
    const model = buildModel(
      source({
        types: { lfo: { category: 'modulator', isMacro: false, triggerable: false } },
        snapshot: {
          name: 's',
          graph: {
            nodes: [
              { id: 'lfo', type: 'lfo' },
              { id: 'depth', type: 'gain' },
              { id: 'glide', type: 'smooth' },
              { id: 'osc', type: 'sine' },
              { id: 'amp', type: 'gain' },
            ],
            edges: [
              { from: 'lfo', to: { node: 'depth' } },
              { from: 'depth', to: { node: 'glide' } },
              { from: 'glide', to: { node: 'osc', param: 'frequency' } },
              { from: 'osc', to: { node: 'amp' } },
            ],
          },
          buses: [],
        },
      }),
    );
    const signal = Object.fromEntries(model.nodes.map((node) => [node.id, node.signal]));
    expect(signal).toEqual({
      lfo: 'control',
      depth: 'control',
      glide: 'control',
      osc: 'audio',
      amp: 'audio',
    });
  });
});

describe('signature', () => {
  it('changes with structure, classes and bypass, and not with parameter values', async () => {
    const engine = await patched();
    const live = engine.scope('live');
    const now = (): string => signature(buildModel(readScope(live).source));
    const start = now();

    live.select('#filter').set({ frequency: 2000 });
    expect(now()).toBe(start);

    live.select('#drive').bypass(false);
    const unbypassed = now();
    expect(unbypassed).not.toBe(start);

    live.select('#kick').first()!.connect(live.select('#filter').first()!);
    const connected = now();
    expect(connected).not.toBe(unbypassed);

    live.chain().sine({ id: 'extra' }).to('main');
    expect(now()).not.toBe(connected);
  });
});

describe('the detail panel data', () => {
  it('lists parameters with values, metadata from the registry, and what modulates them', async () => {
    const engine = await patched();
    const live = engine.scope('live');
    const filter = live.select('#filter').first()!;
    const detail = nodeDetail(filter, engine.registry.describe('lowpass'));
    expect(detail).toMatchObject({
      kind: 'node',
      id: 'filter',
      type: 'lowpass',
      category: 'filter',
      bypassed: false,
      macro: false,
      triggerable: false,
    });
    expect(detail.description).toBe(engine.registry.describe('lowpass').description);
    expect(detail.params.map((param) => param.name)).toEqual(['frequency', 'q']);
    expect(detail.params[0]).toMatchObject({
      name: 'frequency',
      kind: 'number',
      value: 600,
      text: '600 Hz',
      unit: 'hz',
      min: 20,
      max: 20000,
      rate: 'audio',
      modulators: [{ id: 'wobble', type: 'lfo' }],
    });
    expect(detail.params[0]!.description).not.toBe('');
    expect(detail.params[1]!.modulators).toEqual([]);
    expect(detail.inputs).toEqual(['saw #bass']);
    expect(detail.outputs).toEqual(['overdrive #drive']);

    filter.param('frequency').set(1234.5);
    expect(nodeDetail(filter, engine.registry.describe('lowpass')).params[0]).toMatchObject({
      value: 1234.5,
      text: '1235 Hz',
    });
  });

  it('describes outputs to a parameter and to a bus, bypass, classes and macros', async () => {
    const engine = await patched();
    const live = engine.scope('live');
    const info = (type: string) => engine.registry.describe(type);
    expect(nodeDetail(live.select('#wobble').first()!, info('lfo')).outputs).toEqual([
      'frequency of lowpass #filter',
    ]);
    expect(nodeDetail(live.select('#kick').first()!, info('sampler'))).toMatchObject({
      outputs: ['bus drums'],
      triggerable: true,
    });
    expect(nodeDetail(live.select('#snare').first()!, info('sampler')).classes).toEqual([
      'drum',
      'loud',
    ]);
    expect(nodeDetail(live.select('#drive').first()!, info('overdrive')).bypassed).toBe(true);
    const echo = nodeDetail(live.select('#echo').first()!, info('tapedelay'));
    expect(echo.macro).toBe(true);
    expect(echo.params.find((param) => param.name === 'time')).toMatchObject({
      text: '0.3 s',
      unit: 'seconds',
    });
  });

  it('shows booleans and choices as words', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().sampler({ id: 's', buffer: ones(0.01), loop: true });
    const detail = nodeDetail(engine.select('#s').first()!, engine.registry.describe('sampler'));
    expect(detail.params.find((param) => param.name === 'loop')).toMatchObject({
      kind: 'boolean',
      value: true,
      text: 'on',
      min: null,
      max: null,
    });
  });

  it('offers no trigger for things that record when triggered', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().sine({ id: 'osc' }).recorder({ id: 'rec' });
    const rec = engine.select('#rec').first()!;
    expect(engine.registry.describe('recorder').triggerable).toBe(true);
    expect(nodeDetail(rec, engine.registry.describe('recorder')).triggerable).toBe(false);
  });

  it('chooses trigger options that suit the node', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().sine({ id: 'osc' }).to('main');
    engine
      .chain()
      .sampler({ id: 'hit', buffer: ones(0.01) })
      .to('main');
    engine.chain().monosynth({ id: 'synth' }).to('main');
    const options = (id: string) => {
      const node = engine.select(`#${id}`).first()!;
      return triggerOptions(node, engine.registry.describe(node.type));
    };
    expect(options('osc')).toEqual({ duration: 0.3 });
    // A sampler plays its whole sample.
    expect(options('hit')).toEqual({});
    expect(options('synth')).toEqual({ pitch: 60, duration: 0.3 });
  });

  it('describes a bus by its gain and where it goes', async () => {
    const engine = await offlineEngine(0.1);
    const drums = engine.bus('drums');
    drums.gain.set(0.5);
    const detail = busDetail(drums, 'main');
    expect(detail).toMatchObject({ kind: 'bus', id: 'drums', type: 'bus', outputs: ['bus main'] });
    expect(detail.params).toHaveLength(1);
    expect(detail.params[0]).toMatchObject({ name: 'gain', value: 0.5, text: '0.5' });
  });
});

describe('Node.insideScope', () => {
  it('is the private scope of a macro instance, and null for other nodes', async () => {
    const engine = await offlineEngine(0.1);
    engine.chain().sine({ id: 'osc' }).tapedelay({ id: 'echo' }).to('main');
    const echo = engine.select('#echo').first()!;
    const inside = echo.insideScope!;
    expect(inside.owner).toBe(echo);
    expect(inside.select('#feedback').length).toBe(1);
    expect(inside.select('#feedback').first()!.parent).toBe(echo);
    expect(engine.select('#osc').first()!.insideScope).toBeNull();
  });
});
