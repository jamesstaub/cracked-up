import { javascript } from '@codemirror/lang-javascript';
import { EditorState } from '@codemirror/state';
import type { Engine } from '../../src';
import { catalogFromEngine, resolveCatalog } from '../../src/editor';
import type { EditorCatalog, ResolvedCatalog } from '../../src/editor';
import { completionsAt } from '../../src/editor';
import { makeBuffer, offlineEngine } from '../core/setup';

/** An editor state for `code`, and the position of the `|` in it (which is taken out). */
export function stateAt(code: string): { state: EditorState; pos: number } {
  const pos = code.indexOf('|');
  if (pos < 0) throw new Error('mark the cursor with |');
  const doc = code.slice(0, pos) + code.slice(pos + 1);
  return { state: EditorState.create({ doc, extensions: [javascript()] }), pos };
}

let engine: Promise<Engine> | null = null;

/** One offline engine for all the editor tests, with three buffers, one of them sliced. */
export function testEngine(): Promise<Engine> {
  engine ??= (async () => {
    const created = await offlineEngine(0.01);
    created.buffers.add(
      'kick',
      makeBuffer(0.1, () => 0),
    );
    created.buffers.add(
      'hat',
      makeBuffer(0.1, () => 0),
    );
    const sliced = created.buffers.add(
      'break',
      makeBuffer(0.4, () => 0),
    );
    await sliced.ready;
    sliced.slices = [0, 0.1, 0.2, 0.3, 0.4];
    return created;
  })();
  return engine;
}

export async function testCatalog(extra: EditorCatalog = {}): Promise<ResolvedCatalog> {
  return resolveCatalog(catalogFromEngine(await testEngine(), extra));
}

/** The labels offered at the `|` in `code`, in the order given, or null when nothing is offered. */
export function labelsAt(
  code: string,
  catalog: ResolvedCatalog,
  explicit = false,
): string[] | null {
  const { state, pos } = stateAt(code);
  const result = completionsAt(state, pos, catalog, explicit);
  return result ? result.options.map((option) => option.label) : null;
}

/** The whole result at the `|`, for tests that look at more than labels. */
export function resultAt(code: string, catalog: ResolvedCatalog, explicit = false) {
  const { state, pos } = stateAt(code);
  return { state, pos, result: completionsAt(state, pos, catalog, explicit) };
}
