/**
 * The catalog: everything the editor knows about what a script can use. It is plain data, so the
 * editor needs no engine. A page whose scripts run in a sandbox builds it from what the host sent
 * (`RemoteState`); a page with an engine builds it from the engine.
 */

import type {
  BufferInfo,
  Engine,
  MacroDefinition,
  NodeDefinition,
  NodeTypeInfo,
  RemoteState,
  Scope,
  ScopeSnapshot,
} from '../api';
import { describeNodeTypes } from '../describe';
import { HELPER_GROUPS } from '../util/helper-docs';
import type { ReceiverKind } from './api-docs';

/** A function scripts can call by name. */
export interface HelperInfo {
  readonly name: string;
  /** How to call it: `euclid(hits, steps, rotate?)`. */
  readonly signature: string;
  readonly description: string;
  /** An expression using it, and what that gives. */
  readonly example?: string;
  readonly result?: string;
  /** Another name it can be called by. */
  readonly alias?: string;
  /** The heading it is listed under. */
  readonly group?: string;
}

/** A loaded sound, as named in `buffer: 'kick'`. */
export interface BufferEntry {
  readonly key: string;
  /** Seconds, when known. */
  readonly duration?: number | null;
  /** How many slices it is cut into, when it is. */
  readonly slices?: number;
  readonly description?: string;
}

/** Any other name in scope of the script, such as `engine` or a sandbox's `define`. */
export interface GlobalInfo {
  readonly name: string;
  /** For a function, how to call it. */
  readonly signature?: string;
  readonly description: string;
  /**
   * What the name is, when it is one of the library's own objects, so that its members are completed
   * and documented: `'midi'` for a midi object, `'transport'`, `'bus'` and so on.
   */
  readonly kind?: ReceiverKind;
}

/** A bus or a sequence the host knows of, with what it is for. */
export interface NamedEntry {
  readonly name: string;
  readonly description?: string;
}

/** A node the host knows of by its id. */
export interface IdEntry {
  readonly name: string;
  /** Its node type, so that its parameters can be completed where the id is named. */
  readonly type?: string;
  readonly description?: string;
}

// --- Functions of the host's own ---------------------------------------------------------------------

/**
 * What an argument is, which decides what the editor offers inside it:
 *
 * - `'selector'`: a selector string, completed like the string in `__('…')`. Anything that is not a
 *   string (a variable holding a chain, a bus) is left alone.
 * - `'param'`: a parameter name of the nodes that another argument (`of`) refers to.
 * - `'sequence'`, `'bus'`, `'buffer'`: the name of one.
 * - `'name'`: a string of the script's own choosing. Nothing is offered.
 * - `'options'`: an object literal with the keys listed in `options`.
 * - `'list'`: an array literal, each item being what `items` says.
 * - `'value'`: anything. Nothing is offered.
 */
export type ArgumentKind =
  'selector' | 'param' | 'sequence' | 'bus' | 'buffer' | 'name' | 'options' | 'list' | 'value';

/** What a value is: an argument, an item of a list, or the value of an option. */
export interface ValueInfo {
  readonly kind: ArgumentKind;
  /**
   * For `'param'`: the name of the argument of the same call that says which nodes, a `'selector'`
   * or `'bus'` argument. Left out: the parameters of every node type are offered.
   */
  readonly of?: string;
  /** For `'options'`: the keys of the object. */
  readonly options?: readonly OptionKeyInfo[];
  /** For `'list'`: what each item is. */
  readonly items?: ValueInfo;
}

/** One key of an options object a host function takes. */
export interface OptionKeyInfo {
  readonly name: string;
  readonly description?: string;
  /** The value's type as shown: `'number'`, `"'midi' | 'db'"`. Left out: made from `values`. */
  readonly type?: string;
  /** The default as shown. */
  readonly default?: string;
  /** The values it can take, offered after the colon. A string is offered in quotes. */
  readonly values?: readonly (string | number | boolean)[];
  /** Instead of `values`: what the value is, completed as an argument of that kind would be. */
  readonly kind?: 'selector' | 'param' | 'sequence' | 'bus' | 'buffer' | 'boolean';
  /** For `kind: 'param'`: the argument that says which nodes. */
  readonly of?: string;
}

export interface ArgumentInfo extends ValueInfo {
  readonly name: string;
  readonly description?: string;
  readonly optional?: boolean;
}

/** A member of what a host function returns: `value`, `set(value)`. */
export interface MemberInfo {
  readonly name: string;
  /** How to call it. A property has none. */
  readonly signature?: string;
  readonly description: string;
  /** One of the library's own objects, when the member gives one back. */
  readonly returns?: ReceiverKind;
}

/** What a host function gives back. */
export interface ReturnInfo {
  /** A word for it, shown with its members: `'control'`. */
  readonly name?: string;
  readonly description?: string;
  /** When it is one of the library's own objects: `'chain'`, `'selection'`, `'sequence'`... */
  readonly kind?: ReceiverKind;
  /** Otherwise, its members, completed after a dot. */
  readonly members?: readonly MemberInfo[];
}

/** One way of calling a host function. */
export interface FunctionSignature {
  readonly args: readonly ArgumentInfo[];
  /** What this way of calling it does, when that differs from the function's description. */
  readonly description?: string;
  readonly returns?: ReturnInfo;
}

/**
 * A function the host puts in scope of scripts, described well enough for the editor to help
 * inside its brackets. With several signatures, the one that fits the arguments written so far is
 * used: the first whose argument kinds agree with a string, an object or an array where one is.
 */
export interface FunctionInfo {
  readonly name: string;
  readonly description: string;
  readonly signatures: readonly FunctionSignature[];
}

export interface EditorCatalog {
  /** Node types, as from `engine.registry.list()` or `RemoteState.types`. */
  readonly types?: readonly NodeTypeInfo[];
  /** Helper functions. Left out: the library's own (`cracked-up/util`'s `HELPER_GROUPS`). */
  readonly helpers?: readonly HelperInfo[];
  readonly buffers?: readonly (BufferEntry | string)[];
  /**
   * Names that exist outside the document being edited, such as nodes made by another track's
   * script. The editor adds what it finds in its own document to these.
   */
  readonly ids?: readonly (IdEntry | string)[];
  readonly classes?: readonly string[];
  /** Bus names. `main` is always offered. */
  readonly buses?: readonly (NamedEntry | string)[];
  readonly sequences?: readonly (NamedEntry | string)[];
  /** Names of the MIDI inputs and outputs connected, offered where a port is named. */
  readonly midiInputs?: readonly string[];
  readonly midiOutputs?: readonly string[];
  readonly globals?: readonly GlobalInfo[];
  /**
   * Functions of the host's own that scripts call by name, with their arguments described. A name
   * listed here and in `globals` is taken from here.
   */
  readonly functions?: readonly FunctionInfo[];
}

/** The library's own helpers, as catalog data. */
export function builtinHelpers(): HelperInfo[] {
  return HELPER_GROUPS.flatMap((group) =>
    group.helpers.map((doc) => ({
      name: doc.name,
      signature: doc.signature,
      description: doc.description,
      example: doc.setup ? `${doc.setup} ${doc.example}` : doc.example,
      result: doc.result,
      ...(doc.alias ? { alias: doc.alias } : {}),
      group: group.title,
    })),
  );
}

function bufferEntry(info: {
  key: string;
  duration: number | null;
  slices: readonly number[];
}): BufferEntry {
  // Slice boundaries include both ends, so n boundaries cut n - 1 slices.
  const slices = Math.max(0, info.slices.length - 1);
  return { key: info.key, duration: info.duration, ...(slices > 1 ? { slices } : {}) };
}

/**
 * A catalog of what an engine has right now: its node types and its buffers. Call it again, and
 * pass the result to `setCatalog`, when a type is registered or a buffer is added.
 */
export function catalogFromEngine(engine: Engine, extra: EditorCatalog = {}): EditorCatalog {
  return {
    types: engine.registry.list(),
    buffers: engine.buffers.list().map(bufferEntry),
    ...extra,
  };
}

/**
 * A catalog from node definitions alone, for a page that has an editor before it has an engine. With
 * no definitions: the built-in node types. The types are exactly what `catalogFromEngine` would list
 * for an engine with those definitions; it creates no audio context.
 *
 *   catalogFromNodes()                                  // the built-ins
 *   catalogFromNodes([...builtinNodes, myMacro], { buses: ['drums'] })
 */
export function catalogFromNodes(
  definitions?: readonly (NodeDefinition | MacroDefinition)[],
  extra: EditorCatalog = {},
): EditorCatalog {
  return { types: describeNodeTypes(definitions), ...extra };
}

/**
 * The names in a scope's snapshot, as catalog data: each node's id with its type, the classes, and
 * the buses. For merging into a catalog: `catalogFromEngine(engine, catalogFromSnapshot(snapshot))`.
 */
export function catalogFromSnapshot(
  snapshot: ScopeSnapshot,
): Required<Pick<EditorCatalog, 'ids' | 'classes' | 'buses'>> {
  const classes = new Set<string>();
  for (const node of snapshot.graph.nodes) for (const name of node.classes ?? []) classes.add(name);
  return {
    ids: snapshot.graph.nodes.map((node) => ({ name: node.id, type: node.type })),
    classes: [...classes],
    buses: snapshot.buses.map((bus) => bus.name).filter((name) => name !== 'main'),
  };
}

/**
 * The names a scope has right now: what `catalogFromSnapshot` reads, and its named sequences. Call
 * it again after the script has run.
 *
 *   catalogFromEngine(engine, catalogFromScope(scope))
 */
export function catalogFromScope(
  scope: Scope,
): Required<Pick<EditorCatalog, 'ids' | 'classes' | 'buses' | 'sequences'>> {
  return {
    ...catalogFromSnapshot(scope.snapshot()),
    sequences: scope.transport.sequences.flatMap((sequence) => sequence.name ?? []),
  };
}

/**
 * A catalog from what a host sends a sandbox (`link.state()`), for pages that have no engine. When
 * the state has the scope's snapshot, the ids (with their types), classes and buses in it are listed.
 */
export function catalogFromRemoteState(
  state: Pick<RemoteState, 'types'> & {
    readonly buffers?: readonly BufferInfo[];
    readonly snapshot?: ScopeSnapshot;
  },
  extra: EditorCatalog = {},
): EditorCatalog {
  return {
    types: state.types,
    buffers: (state.buffers ?? []).map(bufferEntry),
    ...(state.snapshot ? catalogFromSnapshot(state.snapshot) : {}),
    ...extra,
  };
}

// --- A catalog several editors share --------------------------------------------------------------

export interface CatalogStore {
  /** The current catalog. */
  get(): EditorCatalog;
  /** Replaces the catalog and tells every editor and panel using this store. */
  set(catalog: EditorCatalog): void;
  /** Replaces only the given fields. */
  update(changes: EditorCatalog): void;
  subscribe(listener: (catalog: EditorCatalog) => void): () => void;
}

/** A catalog that several editors and source panels can share: change it once and all follow. */
export function createCatalogStore(initial: EditorCatalog = {}): CatalogStore {
  let current = initial;
  const listeners = new Set<(catalog: EditorCatalog) => void>();
  const store: CatalogStore = {
    get: () => current,
    set(catalog) {
      current = catalog;
      for (const listener of [...listeners]) listener(current);
    },
    update(changes) {
      store.set({ ...current, ...changes });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
}

export const isCatalogStore = (value: EditorCatalog | CatalogStore): value is CatalogStore =>
  typeof (value as CatalogStore).subscribe === 'function';

// --- The catalog as the editor reads it -----------------------------------------------------------

/** A catalog with its defaults filled in and its lists indexed by name. */
export interface ResolvedCatalog {
  readonly source: EditorCatalog;
  readonly types: ReadonlyMap<string, NodeTypeInfo>;
  /** By name and by alias. */
  readonly helpers: ReadonlyMap<string, HelperInfo>;
  readonly helperList: readonly HelperInfo[];
  readonly buffers: readonly BufferEntry[];
  /** The names, in the order given. What else is known of each is in the map beside it. */
  readonly ids: readonly string[];
  readonly idInfo: ReadonlyMap<string, IdEntry>;
  readonly classes: readonly string[];
  readonly buses: readonly string[];
  readonly busInfo: ReadonlyMap<string, NamedEntry>;
  readonly sequences: readonly string[];
  readonly sequenceInfo: ReadonlyMap<string, NamedEntry>;
  readonly midiInputs: readonly string[];
  readonly midiOutputs: readonly string[];
  readonly globals: ReadonlyMap<string, GlobalInfo>;
  /** The host's functions that are well formed: a name and at least one signature. */
  readonly functions: ReadonlyMap<string, FunctionInfo>;
}

/** Entries that may be bare names, by name. One that is neither a string nor named is left out. */
function byName<T extends { readonly name: string }>(
  entries: readonly (T | string)[] | undefined,
): Map<string, T | { readonly name: string }> {
  const found = new Map<string, T | { readonly name: string }>();
  for (const entry of entries ?? []) {
    if (typeof entry === 'string') found.set(entry, { name: entry });
    else if (entry && typeof entry.name === 'string') found.set(entry.name, entry);
  }
  return found;
}

const isFunctionInfo = (info: FunctionInfo): boolean =>
  !!info &&
  typeof info.name === 'string' &&
  Array.isArray(info.signatures) &&
  info.signatures.length > 0 &&
  info.signatures.every((signature) => signature && Array.isArray(signature.args));

let defaultHelpers: HelperInfo[] | null = null;
const resolved = new WeakMap<EditorCatalog, ResolvedCatalog>();

export function resolveCatalog(catalog: EditorCatalog): ResolvedCatalog {
  const known = resolved.get(catalog);
  if (known) return known;
  const helperList = catalog.helpers ?? (defaultHelpers ??= builtinHelpers());
  const helpers = new Map<string, HelperInfo>();
  for (const helper of helperList) {
    helpers.set(helper.name, helper);
    if (helper.alias) helpers.set(helper.alias, helper);
  }
  const idInfo = byName<IdEntry>(catalog.ids);
  const busInfo = byName<NamedEntry>(catalog.buses);
  const sequenceInfo = byName<NamedEntry>(catalog.sequences);
  const result: ResolvedCatalog = {
    source: catalog,
    types: new Map((catalog.types ?? []).map((info) => [info.type, info])),
    helpers,
    helperList,
    buffers: (catalog.buffers ?? []).map((entry) =>
      typeof entry === 'string' ? { key: entry } : entry,
    ),
    ids: [...idInfo.keys()],
    idInfo,
    classes: catalog.classes ?? [],
    buses: [...busInfo.keys()],
    busInfo,
    sequences: [...sequenceInfo.keys()],
    sequenceInfo,
    midiInputs: catalog.midiInputs ?? [],
    midiOutputs: catalog.midiOutputs ?? [],
    globals: new Map((catalog.globals ?? []).map((info) => [info.name, info])),
    functions: new Map(
      (catalog.functions ?? []).filter(isFunctionInfo).map((info) => [info.name, info]),
    ),
  };
  resolved.set(catalog, result);
  return result;
}
