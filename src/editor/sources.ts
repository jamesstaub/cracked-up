/**
 * Where the source viewer gets source code from.
 *
 * The built-in node types, macros and helpers are copied out of the library's TypeScript by
 * `scripts/extract-sources.mjs` into `sources.generated.ts`. That module is only loaded, with a
 * dynamic `import()`, the first time something asks for a source.
 */

/** One piece of source: a definition, or a function it is built by. */
export interface SourcePart {
  /** What this piece is, when it is not the definition itself. */
  readonly label?: string;
  /** Path in the cracked-up repository. */
  readonly file: string;
  /** First and last line in that file, counted from 1. */
  readonly line: number;
  readonly endLine: number;
  readonly code: string;
}

export interface SourceEntry {
  readonly parts: readonly SourcePart[];
  /** The Web Audio node classes the definition constructs (`BiquadFilterNode`), for links to MDN. */
  readonly native: readonly string[];
}

/** Finds the source of a node type or a helper. Resolves to null when there is none. */
export type SourceResolver = (kind: 'type' | 'helper', name: string) => Promise<SourceEntry | null>;

let loading: Promise<typeof import('./sources.generated')> | null = null;

/** The sources of everything built into the library. Loads them on first use. */
export const builtinSources: SourceResolver = async (kind, name) => {
  loading ??= import('./sources.generated');
  const sources = await loading;
  const table = kind === 'type' ? sources.NODE_SOURCES : sources.HELPER_SOURCES;
  return Object.hasOwn(table, name) ? (table[name] ?? null) : null;
};

/** Where the library's source can be read online. */
export const REPOSITORY_URL = 'https://github.com/jamesstaub/cracked-up/blob/main/';

/** The MDN page for a Web Audio interface. */
export const mdnUrl = (name: string): string =>
  `https://developer.mozilla.org/en-US/docs/Web/API/${name}`;
