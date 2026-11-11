/** Selector syntax tree. Positions are zero-based character offsets into the source string. */

export type TagTest =
  | { readonly op: 'present'; readonly name: string }
  | { readonly op: 'equals' | 'not-equals'; readonly name: string; readonly value: string };

/** Parts with no whitespace between them: `sampler.kick#a[role=x]:not(.muted):nth(0)`. */
export interface CompoundSelector {
  /** Type name, or null when absent or when the compound is `*`. */
  readonly type: string | null;
  /** True for `*`. Matches anything, same as having no type. */
  readonly universal: boolean;
  readonly ids: readonly string[];
  readonly classes: readonly string[];
  readonly tags: readonly TagTest[];
  /** Each `:not(...)` contributes a list of compounds; the node must match none of them. */
  readonly not: readonly (readonly CompoundSelector[])[];
  /** `:nth(n)`, or null. Never present inside `:not`. */
  readonly nth: number | null;
  /** Offset of the compound's first character. */
  readonly position: number;
  /** Offset of the `:nth` colon, or -1. */
  readonly nthPosition: number;
}

export type Combinator = 'descendant' | 'child';

export interface SelectorStep {
  /** How this step relates to the previous one; null for the first step. */
  readonly combinator: Combinator | null;
  /** Offset of the combinator (start of the whitespace or the `>`); equals compound.position for the first step. */
  readonly combinatorPosition: number;
  readonly compound: CompoundSelector;
}

/** Steps joined by combinators, e.g. `polysynth > lowpass`. */
export interface ComplexSelector {
  readonly steps: readonly SelectorStep[];
}

/** Comma-separated union of complex selectors. */
export interface SelectorList {
  readonly source: string;
  readonly selectors: readonly ComplexSelector[];
}

export class SelectorError extends Error {
  readonly source: string;
  readonly position: number;

  constructor(message: string, source: string, position: number) {
    super(`${message} at position ${position} in selector ${JSON.stringify(source)}`);
    this.name = 'SelectorError';
    this.source = source;
    this.position = position;
  }
}
