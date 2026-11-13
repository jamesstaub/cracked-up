/**
 * The editor component: a CodeMirror 6 editor for cracked-up scripts, mounted into an element the
 * host supplies. It is plain DOM with no globals, so any number can be on a page, and it works from
 * a catalog of data, so it behaves the same whether scripts run beside it or in a sandbox.
 */

import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionStatus,
} from '@codemirror/autocomplete';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  isolateHistory,
} from '@codemirror/commands';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { bracketMatching, indentOnInput, indentUnit, syntaxTree } from '@codemirror/language';
import {
  Annotation,
  Compartment,
  EditorState,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  showPanel,
} from '@codemirror/view';
import type { DecorationSet, KeyBinding, ViewUpdate } from '@codemirror/view';
import { scanDocument, treeOf } from './analysis';
import { isCatalogStore, resolveCatalog } from './catalog';
import type { CatalogStore, EditorCatalog } from './catalog';
import { completionSource } from './completion';
import { catalogField, definitionAt, intelExtensions, setCatalogEffect } from './intel';
import { createSourcePanel } from './panel';
import type { DefinitionTarget, SourcePanel } from './panel';
import type { SourceResolver } from './sources';
import { applyTheme, editorTheme, ensureStyles } from './theme';
import type { ThemeChoice } from './theme';

/** Where an error is, when the host knows. Lines and columns count from 1; `pos` from 0. */
export interface ErrorPlace {
  line?: number;
  column?: number;
  pos?: number;
}

export interface EditorOptions {
  /** The element to mount into. The editor fills it. */
  parent: HTMLElement;
  /** The starting text. */
  doc?: string;
  /** What scripts can use. A `CatalogStore` can be shared by several editors. */
  catalog?: EditorCatalog | CatalogStore;
  /**
   * Called after each edit the user makes (typing, paste, undo, a completion, `insert`). Not called
   * for `setValue`. It is called on every edit; a host that wants to wait for a pause does that itself.
   */
  onChange?: (value: string, editor: Editor) => void;
  readOnly?: boolean;
  lineNumbers?: boolean;
  lineWrapping?: boolean;
  /** `'auto'` (the default) follows the system's light or dark setting. */
  theme?: ThemeChoice;
  /** Set false if the page supplies `editorStyles` itself. */
  injectStyles?: boolean;
  /** Extra CodeMirror extensions, added after the editor's own. */
  extensions?: Extension;
  /** Extra key bindings, tried before the editor's own: `{ key: 'Mod-Enter', run: () => ... }`. */
  keymap?: readonly KeyBinding[];
  /** Set false to turn off completion, hover tooltips or signature help. */
  autocomplete?: boolean;
  hover?: boolean;
  signatureHelp?: boolean;
  /** Whether `showError` also shows the message in a strip under the code. Default true. */
  errorPanel?: boolean;
  /** The accessible name of the text area. Default "Code". */
  ariaLabel?: string;
  /**
   * Where "go to definition" shows source. Left out: a panel docked at the editor's right edge.
   * An element: a panel is made inside it. A `SourcePanel`: that one is used, and stays the host's
   * to destroy. `false`: no panel; use `onDefinition`.
   */
  sourcePanel?: SourcePanel | HTMLElement | false;
  /** Where the panel gets source code. Left out: the library's own. */
  sources?: SourceResolver;
  /**
   * Called on Cmd/Ctrl-click or F12 on a node type or helper, before anything else happens.
   * Return true to say the host has dealt with it; otherwise the editor jumps to a definition in the
   * script, or shows the source panel.
   */
  onDefinition?: (target: DefinitionTarget, editor: Editor) => boolean | void;
}

export interface SetValueOptions {
  /**
   * `'add'` (the default): the change is one step the user can undo. `'skip'`: it is not in the
   * undo history, for content that changes under the user, such as a collaborator's edit.
   * `'reset'`: the undo history starts again, for showing a different document.
   */
  history?: 'add' | 'skip' | 'reset';
}

export interface Editor {
  /** The editor's outermost element, inside `parent`. */
  readonly element: HTMLElement;
  /** The CodeMirror view, for anything this interface does not cover. */
  readonly view: EditorView;
  /** The source panel "go to definition" uses, or null. */
  readonly sourcePanel: SourcePanel | null;
  /** The current text. */
  readonly value: string;
  /**
   * Replaces the text from the host's side. `onChange` is not called. Only the part that differs is
   * replaced, so the cursor and selection stay where they were in the text that did not change.
   */
  setValue(text: string, options?: SetValueOptions): void;
  /** Types text at the cursor, replacing the selection, as the user would. `onChange` is called. */
  insert(text: string): void;
  setCatalog(catalog: EditorCatalog | CatalogStore): void;
  setReadOnly(readOnly: boolean): void;
  setTheme(theme: ThemeChoice): void;
  /**
   * Shows an error: a string, an `Error`, or the engine's `GraphError`. The line is marked when it
   * is known: from `place`, from a `GraphError`'s `nodeId` (the line that gives that id), or for a
   * `SyntaxError` the first place the editor's own parser could not read. `null` clears it.
   */
  showError(error: unknown, place?: ErrorPlace): void;
  clearError(): void;
  /**
   * Does what Cmd/Ctrl-click does, at a position (default: the cursor). Returns whether there was a
   * node type or helper there.
   */
  goToDefinition(pos?: number): boolean;
  focus(): void;
  /** Removes the editor from the page and everything it added. */
  destroy(): void;
}

// --- Errors -----------------------------------------------------------------------------------------

interface ShownError {
  readonly message: string;
  /** A position on the line to mark, or null. */
  readonly pos: number | null;
}

const setError = StateEffect.define<ShownError | null>();

const errorField = StateField.define<ShownError | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setError)) return effect.value;
    if (value && value.pos !== null && transaction.docChanged) {
      return { message: value.message, pos: transaction.changes.mapPos(value.pos) };
    }
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => (view) => {
      if (!value || value.pos === null) return Decoration.none;
      const pos = Math.min(value.pos, view.state.doc.length);
      const line = view.state.doc.lineAt(pos);
      return Decoration.set([Decoration.line({ class: 'cu-error-line' }).range(line.from)]);
    }),
});

const errorPanel = showPanel.from(errorField, (value) =>
  value
    ? () => {
        const dom = document.createElement('div');
        dom.className = 'cu-error-panel';
        dom.setAttribute('role', 'alert');
        dom.textContent = value.message;
        return { dom };
      }
    : null,
);

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

/** Where in the document an error belongs, as well as can be told. */
function errorPosition(
  state: EditorState,
  error: unknown,
  place: ErrorPlace | undefined,
): number | null {
  const doc = state.doc;
  if (place?.pos !== undefined) return Math.max(0, Math.min(place.pos, doc.length));
  if (place?.line !== undefined) {
    if (place.line < 1 || place.line > doc.lines) return null;
    const line = doc.line(place.line);
    return Math.min(line.from + Math.max(0, (place.column ?? 1) - 1), line.to);
  }
  if (error && typeof error === 'object') {
    const nodeId = (error as { nodeId?: unknown }).nodeId;
    if (typeof nodeId === 'string') {
      const found = scanDocument(state).ids.get(nodeId);
      if (found) return found.pos;
    }
    if (error instanceof Error && error.name === 'SyntaxError') {
      let first: number | null = null;
      treeOf(state).iterate({
        enter(node) {
          if (first !== null) return false;
          if (node.type.isError) first = node.from;
          return undefined;
        },
      });
      return first;
    }
  }
  return null;
}

// --- Small decorations ------------------------------------------------------------------------------

const dunderMark = Decoration.mark({ class: 'cu-dunder' });

/** Colours `__` wherever it is a name, as the static highlighter does. */
const dunderPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter(node) {
            if (
              (node.name === 'VariableName' || node.name === 'VariableDefinition') &&
              node.to - node.from === 2 &&
              view.state.sliceDoc(node.from, node.to) === '__'
            ) {
              builder.add(node.from, node.to, dunderMark);
            }
          },
        });
      }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform);
const hasModifier = (event: MouseEvent | KeyboardEvent): boolean =>
  isMac ? event.metaKey : event.ctrlKey;

const linkMark = Decoration.mark({ class: 'cu-definition-link' });

/** Underlines a node type or helper while Cmd/Ctrl is held over it, to show it can be followed. */
const linkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    private range: { from: number; to: number } | null = null;
    private mouse: { x: number; y: number } | null = null;
    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate): void {
      if (update.docChanged && this.range) this.set(null);
    }
    private set(range: { from: number; to: number } | null): void {
      this.range = range;
      this.decorations = range
        ? Decoration.set([linkMark.range(range.from, range.to)])
        : Decoration.none;
    }
    /** Looks under the mouse and redraws if the link changed. */
    refresh(held: boolean): void {
      let next: { from: number; to: number } | null = null;
      if (held && this.mouse) {
        const pos = this.view.posAtCoords(this.mouse, false);
        try {
          const target = definitionAt(this.view.state, pos, this.view.state.field(catalogField));
          if (target && target.to > target.from) next = { from: target.from, to: target.to };
        } catch {
          next = null;
        }
      }
      if (next?.from === this.range?.from && next?.to === this.range?.to) return;
      this.set(next);
      // An empty transaction, so the view draws the new decorations.
      this.view.dispatch({});
    }
    move(event: MouseEvent): void {
      this.mouse = { x: event.clientX, y: event.clientY };
      this.refresh(hasModifier(event));
    }
    leave(): void {
      this.mouse = null;
      this.refresh(false);
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      mousemove(event) {
        this.move(event);
      },
      mouseleave() {
        this.leave();
      },
      keydown(event) {
        if (event.key === 'Meta' || event.key === 'Control') this.refresh(hasModifier(event));
      },
      keyup(event) {
        if (event.key === 'Meta' || event.key === 'Control') this.refresh(false);
      },
    },
  },
);

// --- The editor -------------------------------------------------------------------------------------

/** Marks a change made by the host through `setValue`, which `onChange` does not report. */
const fromHost = Annotation.define<boolean>();

export function createEditor(options: EditorOptions): Editor {
  const root = document.createElement('div');
  root.className = 'cu-editor';
  const main = document.createElement('div');
  main.className = 'cu-editor-main';
  root.append(main);
  options.parent.append(root);
  applyTheme(root, options.theme);
  if (options.injectStyles !== false) ensureStyles(root);

  let catalogSource: EditorCatalog | CatalogStore = options.catalog ?? {};
  let unsubscribe: (() => void) | null = null;
  let readOnly = options.readOnly ?? false;
  let destroyed = false;
  const readOnlyCompartment = new Compartment();

  const currentCatalog = (): EditorCatalog =>
    isCatalogStore(catalogSource) ? catalogSource.get() : catalogSource;

  // The panel: the host's, one made in the host's element, or one docked in the editor.
  let panel: SourcePanel | null = null;
  let ownsPanel = false;
  const wanted = options.sourcePanel;
  if (wanted !== false) {
    if (wanted && !(wanted instanceof HTMLElement)) panel = wanted;
    else {
      ownsPanel = true;
      panel = createSourcePanel({
        parent: wanted ?? root,
        catalog: catalogSource,
        ...(options.sources ? { sources: options.sources } : {}),
        ...(options.theme ? { theme: options.theme } : {}),
        ...(options.injectStyles === false ? { injectStyles: false } : {}),
        onClose: () => {
          if (!destroyed) view.focus();
        },
      });
    }
  }

  function goToDefinition(pos?: number): boolean {
    const state = view.state;
    const at = pos ?? state.selection.main.head;
    let target: ReturnType<typeof definitionAt> = null;
    try {
      target = definitionAt(state, at, state.field(catalogField));
    } catch {
      target = null;
    }
    if (!target) return false;
    const { from: _from, to: _to, ...definition } = target;
    void _from;
    void _to;
    if (options.onDefinition?.(definition, editor) === true) return true;
    if (definition.local) {
      view.dispatch({
        selection: { anchor: definition.local.from, head: definition.local.to },
        effects: EditorView.scrollIntoView(definition.local.from, { y: 'center' }),
        userEvent: 'select',
      });
      view.focus();
    } else void panel?.show(definition);
    return true;
  }

  function extensions(): Extension[] {
    const list: Extension[] = [
      catalogField.init(() => resolveCatalog(currentCatalog())),
      Prec.high(keymap.of([...(options.keymap ?? [])])),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      EditorState.tabSize.of(2),
      indentUnit.of('  '),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      javascript(),
      editorTheme,
      dunderPlugin,
      errorField,
      linkPlugin,
      readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
      EditorView.contentAttributes.of({
        'aria-label': options.ariaLabel ?? 'Code',
        spellcheck: 'false',
        autocapitalize: 'off',
        autocorrect: 'off',
      }),
      keymap.of([
        // Tab takes the selected completion when the list is open, and indents otherwise.
        {
          key: 'Tab',
          run: (target) => completionStatus(target.state) === 'active' && acceptCompletion(target),
        },
        { key: 'F12', run: () => goToDefinition() },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      Prec.high(
        EditorView.domEventHandlers({
          mousedown(event, target) {
            if (event.button !== 0 || !hasModifier(event) || event.shiftKey || event.altKey)
              return false;
            const pos = target.posAtCoords({ x: event.clientX, y: event.clientY }, false);
            if (!goToDefinition(pos)) return false;
            event.preventDefault();
            return true;
          },
        }),
      ),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || !options.onChange) return;
        const byUser = update.transactions.some(
          (transaction) => transaction.docChanged && !transaction.annotation(fromHost),
        );
        if (byUser) options.onChange(update.state.doc.toString(), editor);
      }),
    ];
    if (options.lineNumbers) list.push(lineNumbers(), highlightActiveLineGutter());
    if (options.lineWrapping) list.push(EditorView.lineWrapping);
    if (options.errorPanel !== false) list.push(errorPanel);
    if (options.autocomplete !== false) {
      list.push(
        autocompletion({
          icons: true,
          maxRenderedOptions: 200,
          // After a key is picked (`gate: `), offer its values at once.
          activateOnCompletion: (completion) => completion.type === 'property',
        }),
        javascriptLanguage.data.of({
          autocomplete: completionSource((state) => state.field(catalogField)),
        }),
      );
    }
    list.push(
      intelExtensions({
        hover: options.hover !== false,
        signatureHelp: options.signatureHelp !== false,
      }),
    );
    if (options.extensions) list.push(options.extensions);
    return list;
  }

  const view = new EditorView({
    parent: main,
    state: EditorState.create({ doc: options.doc ?? '', extensions: extensions() }),
  });

  function watch(next: EditorCatalog | CatalogStore): void {
    unsubscribe?.();
    unsubscribe = null;
    catalogSource = next;
    if (isCatalogStore(next)) {
      unsubscribe = next.subscribe((changed) => {
        view.dispatch({ effects: setCatalogEffect.of(resolveCatalog(changed)) });
      });
    }
  }
  watch(catalogSource);

  const editor: Editor = {
    element: root,
    view,
    get sourcePanel() {
      return panel;
    },
    get value() {
      return view.state.doc.toString();
    },
    setValue(text, setOptions = {}) {
      const mode = setOptions.history ?? 'add';
      if (mode === 'reset') {
        view.setState(EditorState.create({ doc: text, extensions: extensions() }));
        return;
      }
      const old = view.state.doc.toString();
      if (old === text) return;
      // Replace only what differs, so positions in the unchanged text keep their place.
      let start = 0;
      const shortest = Math.min(old.length, text.length);
      while (start < shortest && old.charCodeAt(start) === text.charCodeAt(start)) start++;
      let endOld = old.length;
      let endNew = text.length;
      while (
        endOld > start &&
        endNew > start &&
        old.charCodeAt(endOld - 1) === text.charCodeAt(endNew - 1)
      ) {
        endOld--;
        endNew--;
      }
      view.dispatch({
        changes: { from: start, to: endOld, insert: text.slice(start, endNew) },
        annotations: [
          fromHost.of(true),
          // A step of its own in the undo history, never joined to the typing around it.
          mode === 'skip' ? Transaction.addToHistory.of(false) : isolateHistory.of('full'),
        ],
      });
    },
    insert(text) {
      view.dispatch({
        ...view.state.replaceSelection(text),
        userEvent: 'input',
        scrollIntoView: true,
      });
    },
    setCatalog(next) {
      watch(next);
      view.dispatch({ effects: setCatalogEffect.of(resolveCatalog(currentCatalog())) });
      if (ownsPanel) panel?.setCatalog(next);
    },
    setReadOnly(next) {
      readOnly = next;
      view.dispatch({ effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(next)) });
    },
    setTheme(theme) {
      options.theme = theme;
      applyTheme(root, theme);
      if (ownsPanel) panel?.setTheme(theme);
    },
    showError(error, place) {
      if (error === null || error === undefined) {
        editor.clearError();
        return;
      }
      view.dispatch({
        effects: setError.of({
          message: errorMessage(error),
          pos: errorPosition(view.state, error, place),
        }),
      });
    },
    clearError() {
      if (view.state.field(errorField) !== null) view.dispatch({ effects: setError.of(null) });
    },
    goToDefinition,
    focus() {
      view.focus();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      unsubscribe = null;
      if (ownsPanel) panel?.destroy();
      panel = null;
      view.destroy();
      root.remove();
    },
  };
  return editor;
}
