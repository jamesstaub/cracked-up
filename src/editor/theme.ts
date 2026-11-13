/**
 * How the editor and the source panel look.
 *
 * Every colour and font is a CSS custom property, so a host themes them from its own stylesheet:
 * set `--cu-bg`, `--cu-text`, `--cu-accent` and so on, on the editor's element or anything above it.
 * A property the host does not set falls back to the built-in light or dark value. Which of those
 * applies follows the `theme` option: `'auto'` (the default) follows the system setting, and
 * `'light'` or `'dark'` fixes it.
 *
 * The editor's own parts are styled through a CodeMirror theme, which CodeMirror mounts itself. The
 * custom properties, the tooltips' content and the source panel are in `editorStyles`, a stylesheet
 * that `createEditor` and `createSourcePanel` add to the document (or shadow root) once.
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/** The custom properties, each with its light and dark default. */
const PROPERTIES: Readonly<Record<string, readonly [light: string, dark: string]>> = {
  bg: ['#ffffff', '#1f1f1d'],
  text: ['#1d1d1b', '#ecebe6'],
  muted: ['#6b6a65', '#98968f'],
  border: ['#d9d7cf', '#34332f'],
  accent: ['#b4530a', '#f0a35e'],
  'panel-bg': ['#f6f5f1', '#171716'],
  'hover-bg': ['rgba(0, 0, 0, 0.05)', 'rgba(255, 255, 255, 0.07)'],
  selection: ['rgba(180, 83, 10, 0.22)', 'rgba(240, 163, 94, 0.28)'],
  'active-line': ['rgba(0, 0, 0, 0.035)', 'rgba(255, 255, 255, 0.04)'],
  'error-bg': ['#fdecea', '#3a1917'],
  'error-text': ['#9b1c14', '#ffb4ab'],
  shadow: ['rgba(0, 0, 0, 0.14)', 'rgba(0, 0, 0, 0.5)'],
  'code-comment': ['#737168', '#8f8d85'],
  'code-string': ['#2a7347', '#8fd6a4'],
  'code-number': ['#8f5300', '#e8c170'],
  'code-keyword': ['#8a3ea8', '#cda8f2'],
  'code-dunder': ['#b4530a', '#f0a35e'],
  'code-property': ['#1f5fa8', '#8ebcf2'],
};

const FONTS: Readonly<Record<string, string>> = {
  'font-mono': "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  'font-ui': "system-ui, -apple-system, 'Segoe UI', sans-serif",
  'font-size': '13px',
  'line-height': '1.6',
};

/** The names a host can set, each as `--cu-<name>`. */
export const THEME_PROPERTIES: readonly string[] = [
  ...Object.keys(PROPERTIES),
  ...Object.keys(FONTS),
].map((name) => `--cu-${name}`);

/** `var(--cu-x, var(--cu-default-x))`: the host's value if it set one, else the built-in. */
const v = (name: string): string => `var(--cu-${name}, var(--cu-default-${name}))`;

const defaults = (index: 0 | 1): string =>
  Object.entries(PROPERTIES)
    .map(([name, values]) => `--cu-default-${name}: ${values[index]};`)
    .join(' ');

const fontDefaults = Object.entries(FONTS)
  .map(([name, value]) => `--cu-default-${name}: ${value};`)
  .join(' ');

/** The stylesheet for everything outside CodeMirror's own theme. */
export const editorStyles = `
.cu-themed { ${defaults(0)} ${fontDefaults} color-scheme: light; }
.cu-themed[data-cu-theme="dark"] { ${defaults(1)} color-scheme: dark; }
@media (prefers-color-scheme: dark) {
  .cu-themed:not([data-cu-theme="light"]) { ${defaults(1)} color-scheme: dark; }
}
.cu-editor { display: flex; min-width: 0; min-height: 0; height: 100%; background: ${v('bg')}; color: ${v('text')}; }
.cu-editor-main { flex: 1 1 0; min-width: 0; min-height: 0; display: flex; }
.cu-editor-main > .cm-editor { flex: 1 1 0; min-width: 0; height: 100%; }
.cu-editor > .cu-source-panel { flex: 0 0 min(46%, 520px); border-left: 1px solid ${v('border')}; }
.cu-editor > .cu-source-panel[hidden] { display: none; }

.cu-doc { font: 12px/1.5 ${v('font-ui')}; color: ${v('text')}; padding: 6px 10px; max-width: 460px; }
.cu-doc-head { display: flex; align-items: baseline; gap: 10px; justify-content: space-between; }
.cu-doc-signature { font: 12px/1.5 ${v('font-mono')}; color: ${v('text')}; white-space: pre-wrap; overflow-wrap: anywhere; }
.cu-doc-active { color: ${v('accent')}; font-weight: 600; text-decoration: underline; }
.cu-doc-kind { color: ${v('muted')}; font-size: 11px; white-space: nowrap; }
.cu-doc p { margin: 4px 0 0; }
.cu-doc-note { color: ${v('muted')}; }
.cu-doc-rows { border-collapse: collapse; margin-top: 6px; width: 100%; }
.cu-doc-rows td { vertical-align: top; padding: 2px 10px 2px 0; border-top: 1px solid ${v('border')}; }
.cu-doc-rows td:last-child { padding-right: 0; }
.cu-doc-name { font-family: ${v('font-mono')}; color: ${v('code-property')}; white-space: nowrap; }
.cu-doc-detail { color: ${v('muted')}; font-variant-numeric: tabular-nums; }
.cu-doc-rows .cu-doc-detail { min-width: 9em; }

.cu-source-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; box-sizing: border-box; background: ${v('panel-bg')}; color: ${v('text')}; font: 13px/1.5 ${v('font-ui')}; }
.cu-source-panel * { box-sizing: border-box; }
.cu-source-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid ${v('border')}; flex: none; }
.cu-source-title { font: 600 14px/1.4 ${v('font-mono')}; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cu-source-kind { font-size: 11px; color: ${v('muted')}; border: 1px solid ${v('border')}; border-radius: 999px; padding: 0 8px; white-space: nowrap; }
.cu-source-spacer { flex: 1; }
.cu-source-button { font: inherit; margin: 0; color: inherit; background: ${v('bg')}; border: 1px solid ${v('border')}; border-radius: 6px; padding: 2px 8px; cursor: pointer; line-height: 1.4; }
.cu-source-button:hover:not(:disabled) { border-color: ${v('accent')}; }
.cu-source-button:disabled { opacity: 0.4; cursor: default; }
.cu-source-body { overflow: auto; padding: 10px 12px 24px; flex: 1 1 0; min-height: 0; }
.cu-source-body > p { margin: 0 0 8px; }
.cu-source-heading { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: ${v('muted')}; margin: 16px 0 4px; font-weight: 600; }
.cu-source-signature { display: block; font: 12px/1.5 ${v('font-mono')}; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 8px; }
.cu-source-muted { color: ${v('muted')}; }
.cu-source-body a { color: ${v('accent')}; }
.cu-source-table { border-collapse: collapse; width: 100%; font-size: 12px; }
.cu-source-table td { vertical-align: top; padding: 3px 10px 3px 0; border-bottom: 1px solid ${v('border')}; }
.cu-source-file { border: 1px solid ${v('border')}; border-radius: 6px; margin-top: 8px; overflow: hidden; background: ${v('bg')}; }
.cu-source-file-head { display: flex; gap: 8px; align-items: baseline; padding: 4px 10px; border-bottom: 1px solid ${v('border')}; font: 12px/1.6 ${v('font-mono')}; color: ${v('muted')}; background: ${v('panel-bg')}; }
.cu-source-file-head a { color: inherit; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cu-source-file-head a:hover { color: ${v('accent')}; text-decoration: underline; }
.cu-source-lines { flex: none; margin-left: auto; white-space: nowrap; }
.cu-source-code { display: grid; grid-template-columns: auto minmax(0, 1fr); overflow-x: auto; font: 12px/1.6 ${v('font-mono')}; }
.cu-source-gutter, .cu-source-code pre { margin: 0; padding: 8px 0; font: inherit; }
.cu-source-code .cu-source-gutter { text-align: right; padding-left: 10px; padding-right: 10px; color: ${v('muted')}; user-select: none; white-space: pre; opacity: 0.7; }
.cu-source-code pre { padding-right: 12px; white-space: pre; tab-size: 2; overflow: visible; }
.cu-source-code code { font: inherit; }
.cu-source-link { cursor: pointer; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; }
.cu-source-link:hover, .cu-source-link:focus-visible { color: ${v('accent')}; text-decoration-style: solid; outline: none; }
.cu-themed .tok-comment { color: ${v('code-comment')}; }
.cu-themed .tok-string, .cu-themed .tok-regex { color: ${v('code-string')}; }
.cu-themed .tok-number, .cu-themed .tok-literal { color: ${v('code-number')}; }
.cu-themed .tok-keyword { color: ${v('code-keyword')}; }
.cu-themed .tok-dunder { color: ${v('code-dunder')}; }
.cu-themed .tok-property { color: ${v('code-property')}; }
`;

const STYLE_MARK = 'data-cracked-up-editor';

/** Adds `editorStyles` to the document or shadow root that holds `element`, once. */
export function ensureStyles(element: Element): void {
  const root = element.getRootNode();
  const target: ParentNode =
    root instanceof ShadowRoot ? root : (element.ownerDocument ?? document).head;
  if (target.querySelector(`style[${STYLE_MARK}]`)) return;
  const style = (element.ownerDocument ?? document).createElement('style');
  style.setAttribute(STYLE_MARK, '');
  style.textContent = editorStyles;
  target.append(style);
}

export type ThemeChoice = 'auto' | 'light' | 'dark';

/** Marks an element as themed, and fixes it light or dark unless the choice is `'auto'`. */
export function applyTheme(element: HTMLElement, theme: ThemeChoice = 'auto'): void {
  element.classList.add('cu-themed');
  if (theme === 'auto') element.removeAttribute('data-cu-theme');
  else element.setAttribute('data-cu-theme', theme);
}

/** CodeMirror's own parts, drawn with the custom properties. */
const view = EditorView.theme({
  '&': {
    color: v('text'),
    backgroundColor: v('bg'),
    fontSize: v('font-size'),
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: v('font-mono'),
    lineHeight: v('line-height'),
    fontVariantLigatures: 'none',
  },
  '.cm-content': { padding: '16px 0', caretColor: v('text') },
  '.cm-line': { padding: '0 16px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: v('text') },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: v('selection') },
  '.cm-activeLine': { backgroundColor: v('active-line') },
  '.cm-gutters': {
    backgroundColor: v('bg'),
    color: v('muted'),
    border: 'none',
    borderRight: `1px solid ${v('border')}`,
  },
  '.cm-activeLineGutter': { backgroundColor: v('active-line'), color: v('text') },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px' },
  '&.cm-focused .cm-matchingBracket, .cm-matchingBracket': {
    backgroundColor: 'transparent',
    outline: `1px solid ${v('muted')}`,
    borderRadius: '2px',
  },
  '.cm-nonmatchingBracket': { backgroundColor: 'transparent', color: v('error-text') },
  '.cm-selectionMatch': { backgroundColor: v('hover-bg') },
  '.cu-dunder': { color: v('code-dunder') },
  '.cu-definition-link': {
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
    cursor: 'pointer',
    color: v('accent'),
  },
  '.cu-definition-link *': { color: 'inherit' },
  '.cu-error-line': { backgroundColor: v('error-bg') },
  '.cm-panels': {
    backgroundColor: v('bg'),
    color: v('text'),
  },
  '.cm-panels-bottom': { borderTop: `1px solid ${v('border')}` },
  '.cu-error-panel': {
    padding: '6px 16px',
    font: `12px/1.5 ${v('font-mono')}`,
    backgroundColor: v('error-bg'),
    color: v('error-text'),
    whiteSpace: 'pre-wrap',
  },
  '.cm-tooltip': {
    backgroundColor: v('panel-bg'),
    color: v('text'),
    border: `1px solid ${v('border')}`,
    borderRadius: '6px',
    boxShadow: `0 4px 16px ${v('shadow')}`,
  },
  // A gap between a tooltip and the line it is about, so it never covers the line being typed.
  '.cm-tooltip.cm-tooltip-above': { transform: 'translateY(-8px)' },
  '.cm-tooltip.cm-tooltip-below': { transform: 'translateY(8px)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: v('font-mono'),
    fontSize: '12px',
    maxHeight: '18em',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: '2px 8px 2px 4px',
    lineHeight: '1.5',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: v('selection'),
    color: v('text'),
  },
  '.cm-tooltip-autocomplete completion-section': {
    display: 'list-item',
    fontFamily: v('font-ui'),
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: v('muted'),
    borderBottom: 'none',
    padding: '4px 8px 0',
    opacity: '1',
  },
  '.cm-completionLabel': { color: v('text') },
  '.cm-completionMatchedText': {
    textDecoration: 'none',
    color: v('accent'),
    fontWeight: '600',
  },
  '.cm-completionDetail': {
    color: v('muted'),
    fontStyle: 'normal',
    marginLeft: '1em',
    fontFamily: v('font-ui'),
    fontSize: '11px',
  },
  '.cm-completionIcon': { color: v('muted'), opacity: '0.8', width: '1.2em' },
  '.cm-tooltip.cm-completionInfo': { padding: '0', maxWidth: '480px', width: 'max-content' },
  '.cu-signature-help .cu-doc': { padding: '4px 10px' },
});

/** Token colours: the same six as the static highlighter's, and no change of weight or slant. */
const highlight = HighlightStyle.define([
  { tag: tags.comment, color: v('code-comment') },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: v('code-string') },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: v('code-number') },
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: v('code-keyword') },
  { tag: tags.propertyName, color: v('code-property') },
  // An object's key is plain, as in the static highlighter: only a name after a dot is a property.
  { tag: tags.definition(tags.propertyName), color: v('text') },
]);

export const editorTheme: Extension = [view, syntaxHighlighting(highlight)];
