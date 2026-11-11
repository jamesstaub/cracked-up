/** The facts about a node that selectors can test. */
export interface Selectable {
  readonly id: string;
  readonly type: string;
  readonly classes: ReadonlySet<string>;
  readonly tags: Readonly<Record<string, string | number | boolean>>;
}

/** How the matcher walks the graph. `parent === null` means the root being searched. */
export interface SelectableTree<T extends Selectable> {
  /** Direct children, in creation order. Top-level nodes for null; a macro's inner nodes for a macro node. */
  children(parent: T | null): readonly T[];
}
