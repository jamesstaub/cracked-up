import { SelectorError } from './ast';
import type { CompoundSelector, SelectorList } from './ast';
import { parseSelector } from './parse';
import type { Selectable, SelectableTree } from './types';

function testCompound(node: Selectable, c: CompoundSelector): boolean {
  if (c.type !== null && node.type !== c.type) return false;
  for (const id of c.ids) if (node.id !== id) return false;
  for (const cls of c.classes) if (!node.classes.has(cls)) return false;
  for (const t of c.tags) {
    const has = Object.prototype.hasOwnProperty.call(node.tags, t.name);
    if (t.op === 'present') {
      if (!has) return false;
      continue;
    }
    const equal = has && String(node.tags[t.name]) === t.value;
    if (t.op === 'equals' ? !equal : equal) return false;
  }
  for (const list of c.not) for (const inner of list) if (testCompound(node, inner)) return false;
  return true;
}

const asList = (selector: string | SelectorList): SelectorList =>
  typeof selector === 'string' ? parseSelector(selector) : selector;

/**
 * True if the node matches any compound in the selector. The selector must have no combinators and
 * no `:nth()`; otherwise a SelectorError is thrown.
 */
export function matchesCompound<T extends Selectable>(
  node: T,
  selector: string | SelectorList,
): boolean {
  const list = asList(selector);
  for (const complex of list.selectors) {
    const second = complex.steps[1];
    if (second) {
      throw new SelectorError(
        'Combinators are not allowed here; expected a compound selector',
        list.source,
        second.combinatorPosition,
      );
    }
    const first = complex.steps[0];
    if (first && first.compound.nth !== null) {
      throw new SelectorError(
        ':nth() is not allowed here; expected a compound selector without position',
        list.source,
        first.compound.nthPosition,
      );
    }
  }
  return list.selectors.some((complex) =>
    complex.steps.every((s) => testCompound(node, s.compound)),
  );
}

/**
 * All nodes matching the selector, de-duplicated, in document order (depth-first pre-order).
 * The first step only considers the direct children of `root`; later steps follow their combinator.
 */
export function select<T extends Selectable>(
  selector: string | SelectorList,
  tree: SelectableTree<T>,
  root: T | null = null,
): T[] {
  const list = asList(selector);

  let order: Map<T, number> | null = null;
  const orderOf = (): Map<T, number> => {
    if (order) return order;
    const m = new Map<T, number>();
    const walk = (parent: T | null): void => {
      for (const child of tree.children(parent)) {
        if (!m.has(child)) {
          m.set(child, m.size);
          walk(child);
        }
      }
    };
    walk(root);
    order = m;
    return m;
  };
  const sortDoc = (nodes: Iterable<T>): T[] => {
    const o = orderOf();
    return [...nodes].sort((a, b) => (o.get(a) ?? 0) - (o.get(b) ?? 0));
  };

  const union = new Set<T>();
  for (const complex of list.selectors) {
    let current: T[] = [];
    complex.steps.forEach((step, i) => {
      const c = step.compound;
      let candidates: Set<T>;
      if (i === 0) {
        candidates = new Set(tree.children(root).filter((n) => testCompound(n, c)));
      } else {
        candidates = new Set();
        const collect = (parent: T, deep: boolean): void => {
          for (const child of tree.children(parent)) {
            if (testCompound(child, c)) candidates.add(child);
            if (deep) collect(child, true);
          }
        };
        for (const prev of current) collect(prev, step.combinator === 'descendant');
      }
      let next = i === 0 ? [...candidates] : sortDoc(candidates);
      if (c.nth !== null) {
        const pick = next[c.nth];
        next = pick === undefined ? [] : [pick];
      }
      current = next;
    });
    for (const n of current) union.add(n);
  }
  return list.selectors.length > 1 ? sortDoc(union) : [...union];
}
