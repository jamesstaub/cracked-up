import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CrackedUpError } from '../../src';
import {
  catalogField,
  catalogFromEngine,
  catalogFromRemoteState,
  createCatalogStore,
  createEditor,
  createSourcePanel,
  definitionAt,
  hoverAt,
  resolveCatalog,
  signatureAt,
} from '../../src/editor';
import type { DefinitionTarget, Editor, EditorCatalog, ResolvedCatalog } from '../../src/editor';
import { completionsAt } from '../../src/editor';
import { stateAt, testCatalog, testEngine } from './setup';

let base: EditorCatalog;
let catalog: ResolvedCatalog;
beforeAll(async () => {
  catalog = await testCatalog();
  base = catalog.source;
});

const made: Editor[] = [];
const hosts: HTMLElement[] = [];

function mount(options: Partial<Parameters<typeof createEditor>[0]> = {}): Editor {
  const parent = document.createElement('div');
  parent.style.cssText = 'width: 800px; height: 300px;';
  document.body.append(parent);
  hosts.push(parent);
  const editor = createEditor({ parent, catalog: base, ...options });
  made.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of made.splice(0)) editor.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

/** The labels the editor itself would offer at the end of its text. */
const offered = (editor: Editor): string[] => {
  const state = editor.view.state;
  const result = completionsAt(state, state.doc.length, state.field(catalogField));
  return result ? result.options.map((option) => option.label) : [];
};

/** Types text as the user would: a transaction with a user event. */
function type(editor: Editor, text: string): void {
  const head = editor.view.state.selection.main.head;
  editor.view.dispatch({
    changes: { from: head, insert: text },
    selection: { anchor: head + text.length },
    userEvent: 'input.type',
  });
}

describe('createEditor', () => {
  it('mounts into the element it is given and shows the text', () => {
    const editor = mount({ doc: "__().sine().to('main');" });
    expect(editor.element.parentElement).toBe(hosts[0]);
    expect(editor.value).toBe("__().sine().to('main');");
    expect(editor.element.querySelector('.cm-content')?.textContent).toContain('sine');
    expect(editor.element.querySelector('.cm-content')?.getAttribute('aria-label')).toBe('Code');
  });

  it('reports the user’s edits through onChange, and not setValue', () => {
    const seen: string[] = [];
    const editor = mount({ doc: 'a', onChange: (value) => seen.push(value) });
    editor.setValue('abc');
    expect(editor.value).toBe('abc');
    expect(seen).toEqual([]);
    editor.view.dispatch({ selection: { anchor: 3 } });
    type(editor, 'd');
    expect(seen).toEqual(['abcd']);
    editor.insert('!');
    expect(seen).toEqual(['abcd', 'abcd!']);
  });

  it('keeps the cursor where it was when setValue changes text elsewhere', () => {
    const editor = mount({ doc: 'one\ntwo\nthree' });
    editor.view.dispatch({ selection: { anchor: 5 } }); // in "two"
    editor.setValue('ONE\ntwo\nthree');
    expect(editor.view.state.selection.main.head).toBe(5);
    editor.setValue('ONE and more\ntwo\nthree');
    expect(editor.view.state.sliceDoc(0, editor.view.state.selection.main.head)).toBe(
      'ONE and more\nt',
    );
    editor.setValue('ONE and more\ntwo\nthree\nfour');
    expect(editor.view.state.sliceDoc(0, editor.view.state.selection.main.head)).toBe(
      'ONE and more\nt',
    );
  });

  it('makes setValue one undo step, skips the history, or resets it, as asked', async () => {
    const { undo, undoDepth } = await import('@codemirror/commands');
    const editor = mount({ doc: 'start' });
    editor.view.dispatch({ selection: { anchor: 5 } });
    type(editor, '!');
    editor.setValue('replaced');
    expect(undoDepth(editor.view.state)).toBe(2);
    undo(editor.view);
    expect(editor.value).toBe('start!');
    // A change from elsewhere is not an undo step, and the user's own typing can still be undone.
    editor.setValue('start! and a collaborator', { history: 'skip' });
    expect(undoDepth(editor.view.state)).toBe(1);
    undo(editor.view);
    expect(editor.value).toBe('start and a collaborator');
    editor.setValue('another document', { history: 'reset' });
    expect(editor.value).toBe('another document');
    expect(undoDepth(editor.view.state)).toBe(0);
    // Still a working editor with its catalog after the reset.
    editor.setValue('__().');
    expect(offered(editor)).toContain('lowpass');
  });

  it('can be made read-only and writable again', () => {
    const editor = mount({ doc: 'fixed', readOnly: true });
    expect(editor.view.state.readOnly).toBe(true);
    editor.setValue('set by the host');
    expect(editor.value).toBe('set by the host');
    editor.setReadOnly(false);
    expect(editor.view.state.readOnly).toBe(false);
  });

  it('takes extra key bindings ahead of its own, and extra extensions', async () => {
    const { EditorView } = await import('@codemirror/view');
    let ran = 0;
    const editor = mount({
      doc: 'x',
      keymap: [
        { key: 'Mod-Enter', run: () => (ran++, true) },
        { key: 'Tab', run: () => (ran++, true) },
      ],
      extensions: EditorView.contentAttributes.of({ 'data-host': 'yes' }),
    });
    const content = editor.element.querySelector<HTMLElement>('.cm-content')!;
    expect(content.dataset.host).toBe('yes');
    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(ran).toBe(1);
    expect(editor.value).toBe('x');
  });

  it('shows line numbers only when asked', () => {
    expect(mount().element.querySelector('.cm-lineNumbers')).toBeNull();
    expect(mount({ lineNumbers: true }).element.querySelector('.cm-lineNumbers')).not.toBeNull();
  });

  it('removes everything on destroy, and a second destroy does nothing', () => {
    const store = createCatalogStore(base);
    const editor = mount({ catalog: store });
    const host = hosts[0]!;
    editor.destroy();
    editor.destroy();
    expect(host.childElementCount).toBe(0);
    // The store no longer reaches the destroyed editor.
    expect(() => store.update({ buses: ['x'] })).not.toThrow();
  });
});

describe('the catalog', () => {
  it('is read from an engine: its types, and its buffers with slice counts', async () => {
    const engine = await testEngine();
    const made = catalogFromEngine(engine, { buses: ['reverb'] });
    expect(made.types).toEqual(engine.registry.list());
    expect(made.buffers).toEqual([
      { key: 'kick', duration: 0.1 },
      { key: 'hat', duration: 0.1 },
      { key: 'break', duration: 0.4, slices: 4 },
    ]);
    expect(made.buses).toEqual(['reverb']);
  });

  it('is read from what a host sends a sandbox, with no engine at all', async () => {
    const engine = await testEngine();
    // Through structuredClone, as it would arrive in a frame.
    const state = structuredClone({
      types: engine.registry.list(),
      buffers: [{ key: 'vocal', duration: 2, slices: [0, 1, 2] }],
    });
    const fromRemote = resolveCatalog(catalogFromRemoteState(state));
    const { state: editorState, pos } = stateAt("__().sampler({ buffer: '|' })");
    const result = completionsAt(editorState, pos, fromRemote);
    expect(result?.options.map((option) => option.label)).toEqual(['vocal']);
    expect(result?.options[0]?.detail).toBe('buffer · 2 slices');
    const chain = stateAt('__().|');
    expect(
      completionsAt(chain.state, chain.pos, fromRemote)?.options.map((o) => o.label),
    ).toContain('tapedelay');
  });

  it('can be replaced while the editor is open', () => {
    const editor = mount({ doc: '__().', catalog: {} });
    expect(offered(editor)).not.toContain('lowpass');
    editor.setCatalog(base);
    expect(offered(editor)).toContain('lowpass');
    // A type registered later, as when a macro is defined while the user types.
    const wobble = { ...base.types![0]!, type: 'wobble', description: 'Made later.' };
    editor.setCatalog({ ...base, types: [...base.types!, wobble] });
    expect(offered(editor)).toContain('wobble');
  });

  it('is shared by several editors through a store, each with its own text', () => {
    const store = createCatalogStore(base);
    const first = mount({ doc: "__().sampler({ buffer: '", catalog: store });
    const second = mount({ doc: "__('", catalog: store });
    expect(first.value).not.toBe(second.value);
    expect(offered(first)).toEqual(['kick', 'hat', 'break']);

    // A sample loads, and another track's script makes nodes this one can select.
    store.update({
      buffers: [...(base.buffers ?? []), { key: 'vocal' }],
      ids: ['lead'],
      classes: ['fx'],
    });
    expect(offered(first)).toEqual(['kick', 'hat', 'break', 'vocal']);
    expect(offered(second).slice(0, 2)).toEqual(['#lead', '.fx']);
    expect(store.get().ids).toEqual(['lead']);

    // An editor that has moved to a plain catalog no longer follows the store.
    second.setCatalog({ ...base, ids: ['mine'] });
    store.update({ ids: ['other'] });
    expect(offered(second)[0]).toBe('#mine');
  });

  it('adds the host’s sequences and buses to the document’s own', () => {
    const withHost = resolveCatalog({ ...base, sequences: ['intro'], buses: ['fx'] });
    const { state, pos } = stateAt(
      "__.transport.sequence('beat', { steps: 4 }, () => {});\n__.transport.get('|')",
    );
    expect(completionsAt(state, pos, withHost)?.options.map((o) => o.label)).toEqual([
      'beat',
      'intro',
    ]);
  });

  it('uses the library’s helpers unless the host gives its own', () => {
    expect(resolveCatalog({}).helpers.has('euclid')).toBe(true);
    expect(resolveCatalog({}).helpers.get('fill_array')?.name).toBe('fillArray');
    const own = resolveCatalog({
      helpers: [{ name: 'mine', signature: 'mine(x)', description: 'Mine.' }],
    });
    expect([...own.helpers.keys()]).toEqual(['mine']);
  });
});

describe('showing errors', () => {
  const errorLine = (editor: Editor): string | null =>
    editor.element.querySelector('.cu-error-line')?.textContent ?? null;
  const panelText = (editor: Editor): string | null =>
    editor.element.querySelector('.cu-error-panel')?.textContent ?? null;

  it('shows a message, and clears it', () => {
    const editor = mount({ doc: 'a\nb' });
    editor.showError('It went wrong.');
    expect(panelText(editor)).toBe('It went wrong.');
    expect(errorLine(editor)).toBeNull();
    editor.clearError();
    expect(panelText(editor)).toBeNull();
    editor.showError(new TypeError('x is not a function'));
    expect(panelText(editor)).toBe('TypeError: x is not a function');
    editor.showError(null);
    expect(panelText(editor)).toBeNull();
  });

  it('marks the line it is told', () => {
    const editor = mount({ doc: 'one\ntwo\nthree' });
    editor.showError('Bad.', { line: 2 });
    expect(errorLine(editor)).toBe('two');
    editor.showError('Bad.', { pos: 9 });
    expect(errorLine(editor)).toBe('three');
    editor.showError('Bad.', { line: 99 });
    expect(errorLine(editor)).toBeNull();
    expect(panelText(editor)).toBe('Bad.');
  });

  it('finds the line of a GraphError from its nodeId', () => {
    const editor = mount({
      doc: "__().sine({ id: 'a' }).to('main');\n__().sampler({ id: 'kick', buffer: 'nope' }).to('main');",
    });
    editor.showError({ code: 'buffer', message: 'No buffer "nope".', nodeId: 'kick' });
    expect(errorLine(editor)).toContain("id: 'kick'");
    expect(panelText(editor)).toBe('No buffer "nope".');
    // An id the document does not give is still shown, just not on a line.
    editor.showError({ code: 'buffer', message: 'Elsewhere.', nodeId: 'other-track' });
    expect(errorLine(editor)).toBeNull();
    expect(panelText(editor)).toBe('Elsewhere.');
  });

  it('shows the engine’s own errors', () => {
    const editor = mount({ doc: "__().sine({ id: 'a' });" });
    editor.showError(
      new CrackedUpError('duplicate-id', 'Scope "live" already has "a".', { nodeId: 'a' }),
    );
    expect(panelText(editor)).toContain('already has "a"');
    expect(errorLine(editor)).toContain("id: 'a'");
  });

  it('marks where its own parser gave up, for a SyntaxError with no place', () => {
    const editor = mount({ doc: 'const a = 1;\nconst b = ;\nconst c = 3;' });
    editor.showError(new SyntaxError("Unexpected token ';'"));
    expect(errorLine(editor)).toBe('const b = ;');
  });

  it('keeps the mark on its line as text is typed above it', () => {
    const editor = mount({ doc: 'one\ntwo' });
    editor.showError('Bad.', { line: 2 });
    editor.view.dispatch({ changes: { from: 0, insert: 'zero\n' } });
    expect(errorLine(editor)).toBe('two');
  });

  it('can leave the message to the host and only mark the line', () => {
    const editor = mount({ doc: 'one\ntwo', errorPanel: false });
    editor.showError('Bad.', { line: 1 });
    expect(panelText(editor)).toBeNull();
    expect(errorLine(editor)).toBe('one');
  });
});

describe('hover and signature help', () => {
  const hover = (code: string) => {
    const { state, pos } = stateAt(code);
    return hoverAt(state, pos, catalog)?.doc ?? null;
  };
  const signature = (code: string) => {
    const { state, pos } = stateAt(code);
    return signatureAt(state, pos, catalog)?.doc ?? null;
  };

  it('describes a node type, a method, a setter, a key, a helper and a buffer', () => {
    expect(hover('__().low|pass(200)')?.kind).toBe('filter');
    expect(hover('__().low|pass(200)')?.rows?.map((row) => row.name)).toEqual(['frequency', 'q']);
    expect(hover("__().saw().t|o('main')")?.signature).toBe('to(bus)');
    expect(hover("__('saw').det|une(5)")?.kind).toBe('parameter setter');
    expect(hover('__().lowpass({ fre|quency: 2 })')?.signature).toBe(
      'frequency: 20000 hz · 20 to 20000',
    );
    expect(hover('eu|clid(3, 8)')?.signature).toBe('euclid(hits, steps, rotate?)');
    expect(hover("__().sampler({ buffer: 'bre|ak' })")?.description).toBe('0.4 seconds, 4 slices');
    expect(hover('__.trans|port')?.kind).toBe('__ property');
    expect(hover('_|_()')?.signature).toBe('__(selector?)');
  });

  it('says nothing about what it does not know', () => {
    expect(hover('Math.fl|oor(1)')).toBeNull();
    expect(hover('const sc|ale = 2')).toBeNull();
    expect(hover('// eu|clid')).toBeNull();
    expect(hover('|')).toBeNull();
  });

  it('marks the argument being typed', () => {
    expect(signature('euclid(|')?.active).toBe('hits');
    expect(signature('euclid(3, |')?.active).toBe('steps');
    expect(signature('euclid(3, 8, 1|)')?.active).toBe('rotate');
    expect(signature("__.transport.sequence('a', |")?.active).toBe('options');
    expect(signature("__('saw').ramp('frequency', |")?.active).toBe('target');
    expect(signature('sieve(12, [3, 0], [4, |')?.signature).toContain('sieve(');
  });

  it('shows a type’s signature inside its brackets, and nothing inside a callback', () => {
    expect(signature('__().lowpass(|)')?.signature).toBe('lowpass(frequency | { frequency, q })');
    expect(signature('__().lowpass({ q: 2| })')?.signature).toContain('lowpass(');
    expect(signature("__.transport.every('1 bar', () => { | })")).toBeNull();
    expect(signature('euclid(3, 8)|')).toBeNull();
    expect(signature('foo(|')).toBeNull();
  });
});

describe('go to definition', () => {
  const target = (code: string) => {
    const { state, pos } = stateAt(code);
    return definitionAt(state, pos, catalog);
  };

  it('finds node types and helpers, and nothing else', () => {
    expect(target('__().low|pass(200)')).toMatchObject({ kind: 'type', name: 'lowpass' });
    expect(target('__().lowpass(200).ga|in(1)')?.type?.type).toBe('gain');
    expect(target('const p = eu|clid(3, 8)')).toMatchObject({ kind: 'helper', name: 'euclid' });
    // Under its Cracked name it is still the same helper.
    expect(target('fill_ar|ray(4)')?.name).toBe('fillArray');
    expect(target("__().saw().t|o('main')")).toBeNull();
    expect(target('__.trans|port')).toBeNull();
    expect(target('const eu|clid = 1')).toBeNull();
    expect(target("'low|pass'")).toBeNull();
  });

  it('points into the document for a type the script defines', () => {
    const code = "define({\n  type: 'blip',\n  build(__) {},\n});\n__().bl|ip();";
    const found = target(code);
    expect(found?.local).toEqual({ from: 18, to: 22, line: 2 });
    // And from the definition's own name.
    expect(target("define({ type: 'bl|ip', build(__) {} })")?.name).toBe('blip');
  });

  it('gives the host first refusal, then jumps or shows the panel', async () => {
    const seen: DefinitionTarget[] = [];
    let handle = false;
    const editor = mount({
      doc: "define({\n  type: 'blip',\n  build(__) {},\n});\n__().blip().lowpass(200);",
      onDefinition: (found) => {
        seen.push(found);
        return handle;
      },
    });
    const at = (text: string): number => editor.value.lastIndexOf(text) + 1;

    // A type the script defines: the selection moves to its name.
    expect(editor.goToDefinition(at('blip()'))).toBe(true);
    const range = editor.view.state.selection.main;
    expect(editor.view.state.sliceDoc(range.from, range.to)).toBe('blip');
    expect(range.from).toBe(18);
    expect(editor.sourcePanel?.current).toBeNull();

    // A built-in: the docked panel opens.
    expect(editor.goToDefinition(at('lowpass'))).toBe(true);
    expect(editor.sourcePanel?.current?.name).toBe('lowpass');
    expect(editor.sourcePanel?.element.hidden).toBe(false);
    expect(seen.map((found) => found.name)).toEqual(['blip', 'lowpass']);
    expect(seen[1]?.type?.category).toBe('filter');

    // When the host says it has dealt with it, the editor does nothing more.
    editor.sourcePanel?.close();
    handle = true;
    expect(editor.goToDefinition(at('lowpass'))).toBe(true);
    expect(editor.sourcePanel?.current).toBeNull();
    expect(seen).toHaveLength(3);

    // Nothing there.
    expect(editor.goToDefinition(0)).toBe(false);
    expect(seen).toHaveLength(3);
  });

  it('follows a Cmd/Ctrl-click, and F12', async () => {
    const seen: string[] = [];
    const editor = mount({
      doc: '__().lowpass(200);\nconst p = euclid(3, 8);',
      sourcePanel: false,
      onDefinition: (found) => void seen.push(found.name),
    });
    expect(editor.sourcePanel).toBeNull();
    const coords = editor.view.coordsAtPos(editor.value.indexOf('lowpass') + 3)!;
    const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform);
    const content = editor.element.querySelector<HTMLElement>('.cm-content')!;
    const click = (modified: boolean): void => {
      content.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: coords.left + 1,
          clientY: (coords.top + coords.bottom) / 2,
          metaKey: modified && isMac,
          ctrlKey: modified && !isMac,
        }),
      );
    };
    click(false);
    expect(seen).toEqual([]);
    click(true);
    expect(seen).toEqual(['lowpass']);

    editor.view.dispatch({ selection: { anchor: editor.value.indexOf('euclid') + 2 } });
    content.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F12', bubbles: true, cancelable: true }),
    );
    expect(seen).toEqual(['lowpass', 'euclid']);
  });
});

describe('the source panel', () => {
  const panels: ReturnType<typeof createSourcePanel>[] = [];
  const makePanel = (options: Parameters<typeof createSourcePanel>[0] = {}) => {
    const parent = document.createElement('div');
    document.body.append(parent);
    hosts.push(parent);
    const panel = createSourcePanel({ parent, catalog: base, ...options });
    panels.push(panel);
    return panel;
  };
  afterEach(() => {
    for (const panel of panels.splice(0)) panel.destroy();
  });

  it('stands alone in an element of the host’s, hidden until it has something to show', async () => {
    const panel = makePanel();
    expect(panel.element.hidden).toBe(true);
    expect(panel.element.parentElement).toBe(hosts[hosts.length - 1]);
    await panel.show({ kind: 'type', name: 'lowpass' });
    expect(panel.element.hidden).toBe(false);
    const text = panel.element.textContent ?? '';
    expect(panel.element.querySelector('.cu-source-title')?.textContent).toBe('lowpass');
    expect(panel.element.querySelector('.cu-source-kind')?.textContent).toBe('filter');
    expect(text).toContain('Lets through what is below the cutoff');
    // The parameters table, then the real source with its file and lines.
    expect(
      [...panel.element.querySelectorAll('.cu-source-table .cu-doc-name')].map(
        (n) => n.textContent,
      ),
    ).toEqual(['frequency', 'q']);
    expect(text).toContain("export const lowpass = filter('lowpass', {");
    expect(text).toContain('new BiquadFilterNode(');
    const file = panel.element.querySelector<HTMLAnchorElement>('.cu-source-file-head a')!;
    expect(file.textContent).toBe('src/nodes/filters.ts');
    expect(file.href).toMatch(
      /github\.com\/jamesstaub\/cracked-up\/blob\/main\/src\/nodes\/filters\.ts#L\d+-L\d+$/,
    );
    expect(panel.element.querySelector<HTMLAnchorElement>('.cu-source-native a')?.href).toBe(
      'https://developer.mozilla.org/en-US/docs/Web/API/BiquadFilterNode',
    );
    // Line numbers beside the code, one per line.
    const gutter = panel.element.querySelector('.cu-source-gutter')!.textContent!.split('\n');
    const code = panel.element.querySelector(
      '.cu-source-code pre:not(.cu-source-gutter)',
    )!.textContent!;
    expect(gutter).toHaveLength(code.split('\n').length);
  });

  it('shows a helper with its example and source', async () => {
    const panel = makePanel();
    await panel.show({ kind: 'helper', name: 'euclid' });
    const text = panel.element.textContent ?? '';
    expect(panel.element.querySelector('.cu-source-kind')?.textContent).toBe('helper');
    expect(text).toContain('euclid(hits, steps, rotate?)');
    expect(text).toContain('euclid(3, 8) gives [1, 0, 0, 1, 0, 0, 1, 0]');
    expect(text).toContain('export function euclid(');
    expect(text).toContain('src/util/pattern.ts');
  });

  it('navigates from a type named in the source, and back, and closes', async () => {
    const navigated: string[] = [];
    let closed = 0;
    const panel = makePanel({
      onNavigate: (found) => navigated.push(found.name),
      onClose: () => closed++,
    });
    await panel.show({ kind: 'type', name: 'tapedelay' });
    const back = panel.element.querySelector<HTMLButtonElement>('.cu-source-back')!;
    expect(back.disabled).toBe(true);
    const links = [...panel.element.querySelectorAll<HTMLElement>('.cu-source-link')];
    expect(links.length).toBeGreaterThan(2);
    const delayline = links.find((link) => link.dataset.type === 'delayline')!;
    expect(delayline).toBeDefined();
    delayline.click();
    await expect
      .poll(() => panel.element.querySelector('.cu-source-file-head a')?.textContent)
      .toBe('src/nodes/delays.ts');
    expect(panel.current?.name).toBe('delayline');
    expect(back.disabled).toBe(false);
    back.click();
    await expect
      .poll(() => panel.element.querySelector('.cu-source-file-head a')?.textContent)
      .toBe('src/nodes/tapedelay.ts');
    expect(panel.current?.name).toBe('tapedelay');
    expect(navigated).toEqual(['tapedelay', 'delayline', 'tapedelay']);
    panel.element.querySelector<HTMLButtonElement>('.cu-source-close')!.click();
    expect(panel.element.hidden).toBe(true);
    expect(panel.current).toBeNull();
    expect(closed).toBe(1);
  });

  it('shows what is known, and says so, for a type with no source', async () => {
    const theirs = {
      ...base.types!.find((info) => info.type === 'gain')!,
      type: 'shimmer',
      description: 'Defined by someone else, in a sandbox.',
      isMacro: true,
    };
    const panel = makePanel({ catalog: { types: [...base.types!, theirs] } });
    await panel.show({ kind: 'type', name: 'shimmer' });
    const text = panel.element.textContent ?? '';
    expect(text).toContain('Defined by someone else, in a sandbox.');
    expect(panel.element.querySelector('.cu-source-kind')?.textContent).toBe('utility macro');
    expect(panel.element.querySelector('.cu-source-table .cu-doc-name')?.textContent).toBe('gain');
    expect(panel.element.querySelector('.cu-source-missing')?.textContent).toContain(
      'The source is not available',
    );
    expect(panel.element.querySelector('.cu-source-code')).toBeNull();
  });

  it('takes its source from the host when given a resolver', async () => {
    const panel = makePanel({
      sources: async (kind, name) =>
        kind === 'type' && name === 'gain'
          ? {
              native: [],
              parts: [{ file: 'host/gain.js', line: 7, endLine: 7, code: '// the host’s own' }],
            }
          : null,
    });
    await panel.show({ kind: 'type', name: 'gain' });
    expect(panel.element.querySelector('.cu-source-code')?.textContent).toContain('the host’s own');
    expect(panel.element.querySelector('.cu-source-lines')?.textContent).toBe('line 7');
  });

  it('never reads catalog text as HTML', async () => {
    const hostile = {
      ...base.types![0]!,
      type: 'evil',
      description: '<img src=x onerror="window.__pwned = 1">',
    };
    const panel = makePanel({ catalog: { types: [hostile] } });
    await panel.show({ kind: 'type', name: 'evil' });
    expect(panel.element.querySelector('img')).toBeNull();
    expect(panel.element.textContent).toContain('<img src=x');
    const { state, pos } = stateAt('__().|');
    const option = completionsAt(state, pos, resolveCatalog({ types: [hostile] }))?.options.find(
      (o) => o.label === 'evil',
    );
    expect((option?.info as () => HTMLElement)().querySelector('img')).toBeNull();
  });

  it('is used by an editor that is given it, and left alone when that editor is destroyed', async () => {
    const panel = makePanel();
    const editor = mount({ doc: '__().reverb()', sourcePanel: panel });
    expect(editor.sourcePanel).toBe(panel);
    expect(editor.element.querySelector('.cu-source-panel')).toBeNull();
    editor.goToDefinition(editor.value.indexOf('reverb') + 1);
    await expect
      .poll(() => panel.element.querySelector('.cu-source-file-head a')?.textContent)
      .toBe('src/nodes/reverb.ts');
    editor.destroy();
    expect(panel.element.isConnected).toBe(true);
    expect(panel.current?.name).toBe('reverb');
  });

  it('is made inside an element the editor is given', () => {
    const sidebar = document.createElement('div');
    document.body.append(sidebar);
    hosts.push(sidebar);
    const editor = mount({ sourcePanel: sidebar });
    expect(sidebar.querySelector('.cu-source-panel')).toBe(editor.sourcePanel?.element);
    editor.destroy();
    expect(sidebar.childElementCount).toBe(0);
  });
});

describe('styles', () => {
  it('are added to the document once, however many editors there are', () => {
    mount();
    mount();
    expect(document.head.querySelectorAll('style[data-cracked-up-editor]')).toHaveLength(1);
  });

  it('are added to a shadow root when the editor is in one', () => {
    const host = document.createElement('div');
    document.body.append(host);
    hosts.push(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    shadow.append(inner);
    const editor = createEditor({ parent: inner, catalog: base, doc: '__()' });
    made.push(editor);
    expect(shadow.querySelectorAll('style[data-cracked-up-editor]')).toHaveLength(1);
    expect(editor.value).toBe('__()');
  });

  it('take colours from custom properties the host sets, and fall back to light or dark', () => {
    const editor = mount({ doc: 'x', theme: 'light' });
    const background = () =>
      getComputedStyle(editor.element.querySelector('.cm-editor')!).backgroundColor;
    expect(background()).toBe('rgb(255, 255, 255)');
    editor.setTheme('dark');
    expect(editor.element.dataset.cuTheme).toBe('dark');
    expect(background()).toBe('rgb(31, 31, 29)');
    hosts[0]!.style.setProperty('--cu-bg', 'rgb(1, 2, 3)');
    expect(background()).toBe('rgb(1, 2, 3)');
  });
});
