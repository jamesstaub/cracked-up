/**
 * The view model: what the inspector draws, as plain data.
 *
 * `readScope` collects a scope's `snapshot()` and the few facts a snapshot does not carry (type
 * metadata, chains continued from an outer scope's bus, the scopes inside macros). `buildModel`
 * turns that into nodes and edges to draw. `buildModel` is pure, so it is tested without audio.
 */

import type {
  Bus,
  Node,
  NodeCategory,
  NodeTypeInfo,
  Param,
  ParamMeta,
  ParamValue,
  Scope,
  ScopeSnapshot,
} from '../api';
import { formatNumber } from './meter';

export type ViewNodeKind = 'node' | 'bus' | 'output' | 'scope';
/** `control`: a signal that moves parameters and is not itself heard (an lfo, a smoothed value). */
export type SignalKind = 'audio' | 'control';

export interface ViewNode {
  /** Unique in the whole view. */
  readonly key: string;
  readonly kind: ViewNodeKind;
  /** The node's id, the bus's or scope's name, or `out` for the speakers. */
  readonly id: string;
  /** The node type; `bus`, `scope` or `output` for the other kinds. */
  readonly type: string;
  readonly category: NodeCategory | null;
  readonly classes: readonly string[];
  readonly bypassed: boolean;
  readonly macro: boolean;
  readonly triggerable: boolean;
  /** True when the id looks generated (`gain-0`), so the view can leave it out. */
  readonly autoId: boolean;
  /** A bus that belongs to an outer scope, shown here because something in this scope uses it. */
  readonly external: boolean;
  readonly signal: SignalKind;
  /** A macro or a child scope: it has a graph inside. */
  readonly expandable: boolean;
  /** The graph inside, when it is expanded. */
  readonly children: ViewGraph | null;
}

export interface ViewEdge {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  /**
   * `modulation`: into a parameter. `route`: where a bus sends its mix. `link`: a child scope and an
   * outer bus that something inside it sends to or continues from. A link stands for any number of
   * connections and carries no meter of its own.
   */
  readonly kind: 'audio' | 'modulation' | 'route' | 'link';
  /** For a modulation edge: the parameter it drives. */
  readonly param: string | null;
}

export interface ViewGraph {
  /** Empty for the scope being shown; the key of the macro or scope node for a graph inside one. */
  readonly path: string;
  readonly name: string;
  readonly nodes: readonly ViewNode[];
  readonly edges: readonly ViewEdge[];
}

/** What the model needs to know about a node type. */
export interface TypeFacts {
  readonly category: NodeCategory;
  readonly isMacro: boolean;
  readonly triggerable: boolean;
}

/** Everything `buildModel` reads about one scope. */
export interface ScopeSource {
  readonly snapshot: ScopeSnapshot;
  /** The engine's top scope: its `main` bus feeds the speakers. */
  readonly root: boolean;
  /** The private scope inside a macro: its `in` and `out` buses are the macro's ports. */
  readonly inner: boolean;
  /** Facts for each node type that appears in the snapshot. Unknown types are drawn as plain nodes. */
  readonly types: Readonly<Record<string, TypeFacts>>;
  /** Chains continued from a bus of an outer scope (`bus.chain()`): the bus and the node it feeds. */
  readonly incoming: readonly { readonly bus: string; readonly node: string }[];
  /** The scopes inside macro instances, by node id. Only those that are expanded need be here. */
  readonly macros: Readonly<Record<string, ScopeSource>>;
  readonly children: readonly ScopeSource[];
}

export const nodeKey = (path: string, id: string): string => `${path}#${id}`;
export const busKey = (path: string, name: string): string => `${path}@${name}`;
export const scopeKey = (path: string, name: string): string => `${path}/${name}`;
export const outputKey = (path: string): string => `${path}!out`;

/** Whether a macro or child scope is drawn opened up. */
export type Expanded = (key: string, kind: 'macro' | 'scope') => boolean;

/** Child scopes open, macros closed. */
export const defaultExpanded: Expanded = (_key, kind) => kind === 'scope';

export function buildModel(
  source: ScopeSource,
  expanded: Expanded = defaultExpanded,
  path = '',
): ViewGraph {
  const { snapshot } = source;
  const owned = new Map(snapshot.buses.map((bus) => [bus.name, bus]));
  const nodes = new Map<string, ViewNode>();
  const edges = new Map<string, ViewEdge>();

  const addEdge = (
    from: string,
    to: string,
    kind: ViewEdge['kind'],
    param: string | null = null,
  ): void => {
    const key = `${from}>${to}${param === null ? '' : `:${param}`}`;
    if (!edges.has(key)) edges.set(key, { key, from, to, kind, param });
  };

  for (const data of snapshot.graph.nodes) {
    const facts = Object.hasOwn(source.types, data.type) ? source.types[data.type] : undefined;
    const key = nodeKey(path, data.id);
    const macro = facts?.isMacro ?? false;
    const inner = Object.hasOwn(source.macros, data.id) ? source.macros[data.id] : undefined;
    nodes.set(key, {
      key,
      kind: 'node',
      id: data.id,
      type: data.type,
      category: facts?.category ?? null,
      classes: data.classes ?? [],
      bypassed: data.bypass === true,
      macro,
      triggerable: facts?.triggerable ?? false,
      autoId: new RegExp(`^${escapeRegExp(data.type)}-\\d+$`).test(data.id),
      external: false,
      signal: 'audio',
      expandable: macro,
      children: macro && inner && expanded(key, 'macro') ? buildModel(inner, expanded, key) : null,
    });
  }

  /** Buses are added as they turn out to be used, so a macro's unused port is not drawn. */
  const useBus = (name: string): string => {
    const key = busKey(path, name);
    if (!nodes.has(key)) {
      nodes.set(key, {
        key,
        kind: 'bus',
        id: name,
        type: 'bus',
        category: null,
        classes: [],
        bypassed: false,
        macro: false,
        triggerable: false,
        autoId: false,
        external: !owned.has(name),
        signal: 'audio',
        expandable: false,
        children: null,
      });
    }
    return key;
  };
  // Outside a macro, a bus someone made is shown whether or not anything uses it yet.
  if (!source.inner) for (const name of owned.keys()) useBus(name);

  for (const edge of snapshot.graph.edges) {
    const from = typeof edge.from === 'string' ? nodeKey(path, edge.from) : useBus(edge.from.bus);
    if ('bus' in edge.to) addEdge(from, useBus(edge.to.bus), 'audio');
    else if ('param' in edge.to) {
      addEdge(from, nodeKey(path, edge.to.node), 'modulation', edge.to.param);
    } else addEdge(from, nodeKey(path, edge.to.node), 'audio');
  }
  for (const entry of source.incoming) {
    addEdge(useBus(entry.bus), nodeKey(path, entry.node), 'audio');
  }

  for (const bus of owned.values()) {
    if (bus.to !== null) addEdge(useBus(bus.name), useBus(bus.to), 'route');
    else if (source.root && bus.name === 'main') {
      const key = outputKey(path);
      nodes.set(key, {
        key,
        kind: 'output',
        id: 'out',
        type: 'output',
        category: null,
        classes: [],
        bypassed: false,
        macro: false,
        triggerable: false,
        autoId: false,
        external: false,
        signal: 'audio',
        expandable: false,
        children: null,
      });
      addEdge(useBus(bus.name), key, 'route');
    }
  }

  for (const child of source.children) {
    const key = scopeKey(path, child.snapshot.name);
    nodes.set(key, {
      key,
      kind: 'scope',
      id: child.snapshot.name,
      type: 'scope',
      category: null,
      classes: [],
      bypassed: false,
      macro: false,
      triggerable: false,
      autoId: false,
      external: false,
      signal: 'audio',
      expandable: true,
      children: expanded(key, 'scope') ? buildModel(child, expanded, key) : null,
    });
    const links = outerBuses(child);
    for (const name of links.sends) addEdge(key, useBus(name), 'link');
    for (const name of links.receives) addEdge(useBus(name), key, 'link');
  }

  const all = [...nodes.values()];
  const list = [...edges.values()].filter((edge) => nodes.has(edge.from) && nodes.has(edge.to));
  const control = controlNodes(all, list);
  return {
    path,
    name: snapshot.name,
    nodes: all.map((node) => (control.has(node.key) ? { ...node, signal: 'control' } : node)),
    edges: list,
  };
}

/** The buses of outer scopes that a scope, or anything in its child scopes, sends to or takes from. */
function outerBuses(source: ScopeSource): { sends: Set<string>; receives: Set<string> } {
  const owned = new Set(source.snapshot.buses.map((bus) => bus.name));
  const sends = new Set<string>();
  const receives = new Set<string>();
  for (const edge of source.snapshot.graph.edges) {
    if ('bus' in edge.to && !owned.has(edge.to.bus)) sends.add(edge.to.bus);
  }
  for (const bus of source.snapshot.buses) {
    if (bus.to !== null && !owned.has(bus.to)) sends.add(bus.to);
  }
  for (const entry of source.incoming) if (!owned.has(entry.bus)) receives.add(entry.bus);
  for (const child of source.children) {
    const inner = outerBuses(child);
    for (const name of inner.sends) if (!owned.has(name)) sends.add(name);
    for (const name of inner.receives) if (!owned.has(name)) receives.add(name);
  }
  return { sends, receives };
}

/**
 * Which nodes carry a control signal: modulators, and anything whose whole output ends up in
 * parameters (the gain that scales an lfo, the `smooth` that glides a value).
 */
function controlNodes(nodes: readonly ViewNode[], edges: readonly ViewEdge[]): Set<string> {
  const control = new Set<string>();
  for (const node of nodes) if (node.category === 'modulator') control.add(node.key);
  const outs = new Map<string, ViewEdge[]>();
  for (const edge of edges) {
    const list = outs.get(edge.from);
    if (list) list.push(edge);
    else outs.set(edge.from, [edge]);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.kind !== 'node' || control.has(node.key)) continue;
      const list = outs.get(node.key);
      if (!list || list.length === 0) continue;
      if (list.every((edge) => edge.kind === 'modulation' || control.has(edge.to))) {
        control.add(node.key);
        changed = true;
      }
    }
  }
  return control;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every node of a graph and of the graphs inside it, depth first. */
export function* walk(graph: ViewGraph): Generator<{ node: ViewNode; graph: ViewGraph }> {
  for (const node of graph.nodes) {
    yield { node, graph };
    if (node.children) yield* walk(node.children);
  }
}

/** Everything about a model that changes what is drawn, as one string to compare. */
export function signature(graph: ViewGraph): string {
  const parts: string[] = [];
  const visit = (g: ViewGraph): void => {
    for (const node of g.nodes) {
      parts.push(
        `${node.key}|${node.type}|${node.classes.join(' ')}|${node.bypassed ? 'b' : ''}|${node.signal}|${node.children ? 'open' : ''}`,
      );
      if (node.children) visit(node.children);
    }
    for (const edge of g.edges) parts.push(edge.key);
  };
  visit(graph);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------------------------------
// Reading a live scope
// ---------------------------------------------------------------------------------------------------

/** The live object behind a drawn node. */
export interface Handle {
  readonly node: Node | null;
  readonly bus: Bus | null;
  readonly scope: Scope | null;
}

export interface ScopeReading {
  readonly source: ScopeSource;
  /** By view key. The speakers have no handle. */
  readonly handles: Map<string, Handle>;
  /** Every scope that was read, for subscribing to their events. */
  readonly scopes: Scope[];
}

/** A scope's own nodes. `select('*')` also returns the nodes of child scopes, which are left out. */
export function nodesOf(scope: Scope): readonly Node[] {
  return scope.select('*').nodes.filter((node) => node.scope === scope);
}

export function readScope(scope: Scope, expanded: Expanded = defaultExpanded): ScopeReading {
  const handles = new Map<string, Handle>();
  const scopes: Scope[] = [];
  const source = readInto(scope, expanded, '', handles, scopes);
  return { source, handles, scopes };
}

function readInto(
  scope: Scope,
  expanded: Expanded,
  path: string,
  handles: Map<string, Handle>,
  scopes: Scope[],
): ScopeSource {
  scopes.push(scope);
  const snapshot = scope.snapshot();
  const registry = scope.engine.registry;
  const owned = new Set(snapshot.buses.map((bus) => bus.name));
  const types: Record<string, TypeFacts> = {};
  const macros: Record<string, ScopeSource> = {};
  const incoming: { bus: string; node: string }[] = [];

  for (const data of snapshot.graph.nodes) {
    if (!Object.hasOwn(types, data.type) && registry.has(data.type)) {
      const info = registry.describe(data.type);
      types[data.type] = {
        category: info.category,
        isMacro: info.isMacro,
        triggerable: info.triggerable,
      };
    }
  }

  const ancestors = new Set<Scope>();
  for (let outer = scope.parent; outer; outer = outer.parent) ancestors.add(outer);

  for (const node of nodesOf(scope)) {
    const key = nodeKey(path, node.id);
    handles.set(key, { node, bus: null, scope: null });
    for (const edge of node.inputs) {
      // A chain continued from an outer scope's bus comes from that bus's own gain node, which the
      // outer scope does not list. `describe()` leaves these connections out, so find them here.
      const from = edge.from;
      if (from.scope === scope || !ancestors.has(from.scope) || !from.id.startsWith('bus:')) {
        continue;
      }
      const name = from.id.slice(4);
      if (owned.has(name)) continue;
      if (scope.bus(name).output === from.output) incoming.push({ bus: name, node: node.id });
    }
    const inside = node.insideScope;
    if (inside && expanded(key, 'macro')) {
      macros[node.id] = readInto(inside, expanded, key, handles, scopes);
    }
  }

  const children = scope.children.map((child) =>
    readInto(child, expanded, scopeKey(path, child.name), handles, scopes),
  );
  for (const child of scope.children) {
    handles.set(scopeKey(path, child.name), { node: null, bus: null, scope: child });
  }

  const source: ScopeSource = {
    snapshot,
    root: scope.parent === null && scope.owner === null,
    inner: scope.owner !== null,
    types,
    incoming,
    macros,
    children,
  };

  // Every bus the model will draw: this scope's own, and outer ones something here refers to. Each
  // of those names exists, here or further out, so `bus()` finds it and creates nothing.
  const names = new Set<string>(owned);
  for (const edge of snapshot.graph.edges) if ('bus' in edge.to) names.add(edge.to.bus);
  for (const bus of snapshot.buses) if (bus.to !== null) names.add(bus.to);
  for (const entry of incoming) names.add(entry.bus);
  for (const child of children) {
    const links = outerBuses(child);
    for (const name of [...links.sends, ...links.receives]) names.add(name);
  }
  for (const name of names) {
    handles.set(busKey(path, name), { node: null, bus: scope.bus(name), scope: null });
  }
  return source;
}

// ---------------------------------------------------------------------------------------------------
// The detail panel's data
// ---------------------------------------------------------------------------------------------------

export interface ParamDetail {
  readonly name: string;
  readonly kind: ParamMeta['kind'];
  /** The base value: what was set. It does not include ramps in flight, offsets or modulation. */
  readonly value: ParamValue;
  /** The value with its unit, for display. */
  readonly text: string;
  readonly unit: string;
  readonly min: number | null;
  readonly max: number | null;
  readonly default: ParamValue;
  readonly rate: ParamMeta['rate'];
  readonly description: string;
  /** Nodes connected to this parameter. */
  readonly modulators: readonly { readonly id: string; readonly type: string }[];
}

export interface NodeDetail {
  readonly kind: 'node' | 'bus';
  readonly id: string;
  readonly type: string;
  readonly category: NodeCategory | null;
  readonly description: string;
  readonly classes: readonly string[];
  readonly tags: Readonly<Record<string, string | number | boolean>>;
  readonly bypassed: boolean;
  readonly macro: boolean;
  /** Whether the panel offers a trigger button. Recorders and loopers are left out: a trigger there records. */
  readonly triggerable: boolean;
  readonly params: readonly ParamDetail[];
  /** What feeds it and what it feeds, as short labels. */
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
}

const UNIT_SUFFIX: Readonly<Record<string, string>> = {
  hz: ' Hz',
  db: ' dB',
  seconds: ' s',
  ms: ' ms',
  beats: ' beats',
  cents: ' ct',
  semitones: ' st',
};

export function formatParam(value: ParamValue, meta: ParamMeta): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'string') return value;
  return formatNumber(value) + (meta.kind === 'number' ? (UNIT_SUFFIX[meta.unit] ?? '') : '');
}

function paramDetail(param: Param): ParamDetail {
  const meta = param.meta;
  return {
    name: param.name,
    kind: meta.kind,
    value: param.value,
    text: formatParam(param.value, meta),
    unit: meta.kind === 'number' ? meta.unit : 'none',
    min: meta.kind === 'number' ? meta.min : null,
    max: meta.kind === 'number' ? meta.max : null,
    default: meta.default,
    rate: meta.rate,
    description: meta.description ?? '',
    modulators: param.modulators.map((mod) => ({ id: mod.source.id, type: mod.source.type })),
  };
}

const label = (node: { type: string; id: string }): string =>
  node.id.startsWith('bus:') ? `bus ${node.id.slice(4)}` : `${node.type} #${node.id}`;

function endLabel(end: Node | Bus | Param<number>): string {
  if ('meta' in end) return `${end.name} of ${label(end.node)}`;
  if ('params' in end) return label(end);
  return `bus ${end.name}`;
}

/** What the detail panel shows for a node. `info` is the registry's entry for its type, if it has one. */
export function nodeDetail(node: Node, info: NodeTypeInfo | null): NodeDetail {
  return {
    kind: 'node',
    id: node.id,
    type: node.type,
    category: info?.category ?? null,
    description: info?.description ?? '',
    classes: [...node.classes],
    tags: node.tags,
    bypassed: node.bypass,
    macro: info?.isMacro ?? false,
    triggerable: (info?.triggerable ?? false) && info?.category !== 'io',
    params: Object.keys(node.params).map((name) => paramDetail(node.param(name))),
    inputs: node.inputs.map((edge) => label(edge.from)),
    outputs: node.outputs.map((edge) => endLabel(edge.to)),
  };
}

export function busDetail(bus: Bus, to: string | null): NodeDetail {
  return {
    kind: 'bus',
    id: bus.name,
    type: 'bus',
    category: null,
    description:
      'A named mix point: several chains go in, one signal comes out. ' +
      (to === null ? '' : `This one is sent on to the bus "${to}".`),
    classes: [],
    tags: {},
    bypassed: false,
    macro: false,
    triggerable: false,
    params: [paramDetail(bus.gain as Param)],
    inputs: [],
    outputs: to === null ? [] : [`bus ${to}`],
  };
}

/**
 * What to pass to `trigger()` when the panel's button is pressed: a short note for things with a
 * gate, middle C for synths, and nothing for samplers so the whole sample plays.
 */
export function triggerOptions(node: Node, info: NodeTypeInfo | null): Record<string, number> {
  const options: Record<string, number> = {};
  if (!info) return options;
  if (Object.hasOwn(info.triggerOptions, 'pitch')) options['pitch'] = 60;
  const sampler = Object.hasOwn(node.params, 'speed') || Object.hasOwn(node.params, 'loop');
  if (Object.hasOwn(info.triggerOptions, 'duration') && !sampler) options['duration'] = 0.3;
  return options;
}
