/**
 * Problems the host has found, shown in the editor: an underline under each, its line marked in the
 * gutter, and the message on hover or with F8. The host sets the whole list and replaces or clears
 * it; in between, each problem keeps its place in the text as the text changes.
 *
 * This is a state field and decorations from the CodeMirror packages the editor already needs. It
 * keeps nothing outside the editor's state, so each editor on a page has its own list.
 */

import { RangeSet, StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Extension, Range, Text } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutterLineClass,
  hoverTooltip,
  keymap,
  showTooltip,
} from '@codemirror/view';
import type { Tooltip } from '@codemirror/view';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * A problem at a place in the text. The place is `from` (and `to`), counted from 0, or else `line`
 * (and `column`), counted from 1. A line with no column means the whole line; a column with no end
 * means the word that starts there.
 */
export interface EditorDiagnostic {
  from?: number;
  to?: number;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  severity: DiagnosticSeverity;
  message: string;
  /** Who says so, shown after the message: `'controls'`. */
  source?: string;
}

/** A problem as the editor holds it: where it is in the text now. */
export interface PlacedDiagnostic {
  readonly from: number;
  readonly to: number;
  /** The line and column of `from`, counted from 1. */
  readonly line: number;
  readonly column: number;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly source?: string;
}

interface Held {
  readonly from: number;
  readonly to: number;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly source?: string;
}

const SEVERITIES: readonly DiagnosticSeverity[] = ['error', 'warning', 'info'];
const rank = (severity: DiagnosticSeverity): number => SEVERITIES.indexOf(severity);

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(value, high));

function positionOf(doc: Text, line: number, column: number | undefined): number | null {
  if (!Number.isFinite(line) || line < 1 || line > doc.lines) return null;
  const at = doc.line(Math.floor(line));
  return Math.min(at.from + Math.max(0, Math.floor(column ?? 1) - 1), at.to);
}

/** Where a diagnostic is in this document, or null when it names a place the document has not got. */
function place(doc: Text, given: EditorDiagnostic): Held | null {
  if (!given || typeof given !== 'object') return null;
  const severity = SEVERITIES.includes(given.severity) ? given.severity : 'error';
  let from: number;
  let to: number;
  if (typeof given.from === 'number' && Number.isFinite(given.from)) {
    from = clamp(Math.floor(given.from), 0, doc.length);
    to = clamp(Math.floor(typeof given.to === 'number' ? given.to : from), from, doc.length);
  } else if (typeof given.line === 'number') {
    const start = positionOf(doc, given.line, given.column);
    if (start === null) return null;
    const line = doc.lineAt(start);
    from = start;
    if (typeof given.endLine === 'number' || typeof given.endColumn === 'number') {
      const end = positionOf(doc, given.endLine ?? given.line, given.endColumn ?? line.length + 1);
      to = Math.max(from, end ?? line.to);
    } else if (typeof given.column === 'number') {
      // The word that starts at the column, or one character.
      const word = /^[\w$]+/.exec(line.text.slice(from - line.from))?.[0];
      to = Math.min(line.to, from + (word?.length ?? 1));
    } else {
      // The whole line, without the space it is indented by.
      from = line.from + (line.text.length - line.text.trimStart().length);
      to = line.to;
    }
  } else return null;
  return {
    from,
    to,
    severity,
    message: String(given.message ?? ''),
    ...(typeof given.source === 'string' ? { source: given.source } : {}),
  };
}

const setDiagnosticsEffect = StateEffect.define<readonly EditorDiagnostic[]>();
/** The index of the diagnostic whose message is shown at the cursor, or null. */
const showDiagnosticEffect = StateEffect.define<number | null>();

interface DiagnosticState {
  readonly items: readonly Held[];
  /** The one F8 last went to, whose message is shown until the cursor moves. */
  readonly shown: number | null;
}

const NONE: DiagnosticState = { items: [], shown: null };

const diagnosticField = StateField.define<DiagnosticState>({
  create: () => NONE,
  update(value, transaction) {
    let { items, shown } = value;
    if (transaction.docChanged && items.length > 0) {
      const mapped: Held[] = [];
      for (const item of items) {
        const from = transaction.changes.mapPos(item.from, 1);
        const to = transaction.changes.mapPos(item.to, -1);
        // A problem whose text was all deleted has gone with it.
        if (item.to > item.from && to <= from) continue;
        mapped.push({ ...item, from, to: Math.max(from, to) });
      }
      items = mapped;
    }
    if (transaction.docChanged || transaction.selection) shown = null;
    for (const effect of transaction.effects) {
      if (effect.is(setDiagnosticsEffect)) {
        const doc = transaction.state.doc;
        items = effect.value
          .flatMap((given) => place(doc, given) ?? [])
          .sort((a, b) => a.from - b.from || rank(a.severity) - rank(b.severity));
        shown = null;
      } else if (effect.is(showDiagnosticEffect)) shown = effect.value;
    }
    return items === value.items && shown === value.shown
      ? value
      : items.length === 0 && shown === null
        ? NONE
        : { items, shown };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => (view) => marks(view.state.doc, value.items)),
    gutterLineClass.compute([field], (state) => gutterMarks(state.doc, state.field(field).items)),
    showTooltip.from(field, (value) => {
      const item = value.shown === null ? undefined : value.items[value.shown];
      return item ? tooltip(item.from, item.to, [item]) : null;
    }),
  ],
});

const markOf = (severity: DiagnosticSeverity): Decoration =>
  Decoration.mark({ class: `cu-diagnostic cu-diagnostic-${severity}` });
const MARKS: Readonly<Record<DiagnosticSeverity, Decoration>> = {
  error: markOf('error'),
  warning: markOf('warning'),
  info: markOf('info'),
};
const lineOf = (severity: DiagnosticSeverity): Decoration =>
  Decoration.line({ class: `cu-diagnostic-line cu-diagnostic-line-${severity}` });
const LINES: Readonly<Record<DiagnosticSeverity, Decoration>> = {
  error: lineOf('error'),
  warning: lineOf('warning'),
  info: lineOf('info'),
};

/** An underline under each problem; a problem with no text to underline marks its line instead. */
function marks(doc: Text, items: readonly Held[]) {
  const ranges: Range<Decoration>[] = [];
  for (const item of items) {
    const from = Math.min(item.from, doc.length);
    const to = Math.min(item.to, doc.length);
    if (to > from) ranges.push(MARKS[item.severity].range(from, to));
    else ranges.push(LINES[item.severity].range(doc.lineAt(from).from));
  }
  return Decoration.set(ranges, true);
}

class SeverityMarker extends GutterMarker {
  constructor(readonly severity: DiagnosticSeverity) {
    super();
    this.elementClass = `cu-diagnostic-gutter cu-diagnostic-gutter-${severity}`;
  }
  override eq(other: SeverityMarker): boolean {
    return other.severity === this.severity;
  }
}
const GUTTER: Readonly<Record<DiagnosticSeverity, SeverityMarker>> = {
  error: new SeverityMarker('error'),
  warning: new SeverityMarker('warning'),
  info: new SeverityMarker('info'),
};

/** The worst severity of each line that has a problem, for the line number beside it. */
function gutterMarks(doc: Text, items: readonly Held[]): RangeSet<GutterMarker> {
  const worst = new Map<number, DiagnosticSeverity>();
  for (const item of items) {
    const line = doc.lineAt(Math.min(item.from, doc.length)).from;
    const known = worst.get(line);
    if (known === undefined || rank(item.severity) < rank(known)) worst.set(line, item.severity);
  }
  return RangeSet.of(
    [...worst].sort((a, b) => a[0] - b[0]).map(([line, severity]) => GUTTER[severity].range(line)),
  );
}

/** The messages as DOM. Text nodes only: a message is never read as HTML. */
function messages(items: readonly Held[]): HTMLElement {
  const root = document.createElement('div');
  root.className = 'cu-diagnostic-tooltip';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  for (const item of items) {
    const row = document.createElement('div');
    row.className = `cu-diagnostic-message cu-diagnostic-message-${item.severity}`;
    const label = document.createElement('span');
    label.className = 'cu-diagnostic-severity';
    label.textContent = item.severity;
    const text = document.createElement('span');
    text.className = 'cu-diagnostic-text';
    text.textContent = item.message;
    row.append(label, text);
    if (item.source) {
      const source = document.createElement('span');
      source.className = 'cu-diagnostic-source';
      source.textContent = item.source;
      row.append(source);
    }
    root.append(row);
  }
  return root;
}

function tooltip(from: number, to: number, items: readonly Held[]): Tooltip {
  return { pos: from, end: to, above: false, create: () => ({ dom: messages(items) }) };
}

/** The problems that cover a position; one with no width counts on its whole line. */
function covering(state: EditorState, pos: number): Held[] {
  const { items } = state.field(diagnosticField, false) ?? NONE;
  return items.filter((item) => {
    if (item.to > item.from) return pos >= item.from && pos <= item.to;
    const line = state.doc.lineAt(Math.min(item.from, state.doc.length));
    return pos >= line.from && pos <= line.to;
  });
}

/** Moves the cursor to the next or previous problem and shows its message. */
function step(view: EditorView, direction: 1 | -1): boolean {
  const { items } = view.state.field(diagnosticField, false) ?? NONE;
  if (items.length === 0) return false;
  const head = view.state.selection.main.head;
  let index = -1;
  if (direction === 1) index = items.findIndex((item) => item.from > head);
  else
    for (let i = items.length - 1; i >= 0 && index < 0; i--) if (items[i]!.from < head) index = i;
  if (index < 0) index = direction === 1 ? 0 : items.length - 1;
  const item = items[index]!;
  // The selection first, then the message: a change of selection hides the message shown before.
  view.dispatch({
    selection: { anchor: item.from },
    effects: [
      EditorView.scrollIntoView(item.from, { y: 'nearest' }),
      showDiagnosticEffect.of(index),
    ],
    userEvent: 'select',
  });
  return true;
}

/** The field, the hover tooltip and the keys: F8 and Shift-F8 go to the next and previous problem. */
export function diagnosticExtensions(): Extension {
  return [
    diagnosticField,
    hoverTooltip(
      (view, pos) => {
        const found = covering(view.state, pos);
        if (found.length === 0) return null;
        return tooltip(
          Math.min(...found.map((item) => item.from)),
          Math.max(...found.map((item) => item.to)),
          found,
        );
      },
      { hoverTime: 250 },
    ),
    keymap.of([
      { key: 'F8', run: (view) => step(view, 1), shift: (view) => step(view, -1) },
      {
        key: 'Escape',
        run(view) {
          if ((view.state.field(diagnosticField, false) ?? NONE).shown === null) return false;
          view.dispatch({ effects: showDiagnosticEffect.of(null) });
          return true;
        },
      },
    ]),
  ];
}

/** Replaces an editor's problems. An empty list clears them. */
export function setDiagnostics(view: EditorView, diagnostics: readonly EditorDiagnostic[]): void {
  const held = view.state.field(diagnosticField, false);
  if (!held || (diagnostics.length === 0 && held.items.length === 0)) return;
  view.dispatch({ effects: setDiagnosticsEffect.of(diagnostics) });
}

/** An editor's problems, each where it is in the text now. */
export function diagnosticsOf(state: EditorState): PlacedDiagnostic[] {
  const { items } = state.field(diagnosticField, false) ?? NONE;
  return items.map((item) => {
    const line = state.doc.lineAt(Math.min(item.from, state.doc.length));
    return { ...item, line: line.number, column: item.from - line.from + 1 };
  });
}

/** The messages that hovering a position would show, for hosts and tests that ask directly. */
export function diagnosticsAt(state: EditorState, pos: number): PlacedDiagnostic[] {
  const found = new Set(covering(state, pos));
  const { items } = state.field(diagnosticField, false) ?? NONE;
  return diagnosticsOf(state).filter((_, index) => found.has(items[index]!));
}
