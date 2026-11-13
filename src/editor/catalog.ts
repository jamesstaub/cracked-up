/**
 * The catalog: everything the editor knows about what a script can use. It is plain data, so the
 * editor needs no engine. A page whose scripts run in a sandbox builds it from what the host sent
 * (`RemoteState`); a page with an engine builds it from the engine.
 */

import type { BufferInfo, Engine, NodeTypeInfo, RemoteState } from '../api';
import { HELPER_GROUPS } from '../util/helper-docs';

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
  readonly ids?: readonly string[];
  readonly classes?: readonly string[];
  /** Bus names. `main` is always offered. */
  readonly buses?: readonly string[];
  readonly sequences?: readonly string[];
  readonly globals?: readonly GlobalInfo[];
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

/** A catalog from what a host sends a sandbox (`link.state()`), for pages that have no engine. */
export function catalogFromRemoteState(
  state: Pick<RemoteState, 'types'> & { readonly buffers?: readonly BufferInfo[] },
  extra: EditorCatalog = {},
): EditorCatalog {
  return {
    types: state.types,
    buffers: (state.buffers ?? []).map(bufferEntry),
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
  readonly ids: readonly string[];
  readonly classes: readonly string[];
  readonly buses: readonly string[];
  readonly sequences: readonly string[];
  readonly globals: ReadonlyMap<string, GlobalInfo>;
}

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
  const result: ResolvedCatalog = {
    source: catalog,
    types: new Map((catalog.types ?? []).map((info) => [info.type, info])),
    helpers,
    helperList,
    buffers: (catalog.buffers ?? []).map((entry) =>
      typeof entry === 'string' ? { key: entry } : entry,
    ),
    ids: catalog.ids ?? [],
    classes: catalog.classes ?? [],
    buses: catalog.buses ?? [],
    sequences: catalog.sequences ?? [],
    globals: new Map((catalog.globals ?? []).map((info) => [info.name, info])),
  };
  resolved.set(catalog, result);
  return result;
}
