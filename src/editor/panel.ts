/**
 * The source viewer: a panel that shows what a node type or helper is and the code that defines it.
 * It is a piece of its own, so a host can put it in a sidebar or a popup; the editor uses one for
 * "go to definition" unless the host handles that itself.
 */

import type { NodeTypeInfo } from '../api';
import { isCatalogStore, resolveCatalog } from './catalog';
import type { CatalogStore, EditorCatalog, HelperInfo, ResolvedCatalog } from './catalog';
import { el, formatNumber, optionDetail, paramDetail, typeKind, typeSignature } from './docs';
import { tokenize } from './highlight';
import { REPOSITORY_URL, builtinSources, mdnUrl } from './sources';
import type { SourceEntry, SourcePart, SourceResolver } from './sources';
import { applyTheme, ensureStyles } from './theme';
import type { ThemeChoice } from './theme';

/** What "go to definition" found: a node type or a helper, and where it is defined if in the script. */
export interface DefinitionTarget {
  readonly kind: 'type' | 'helper';
  readonly name: string;
  /** The catalog's (or the document's) description of a node type. */
  readonly type?: NodeTypeInfo;
  readonly helper?: HelperInfo;
  /** Set when the script being edited defines the type itself: where, in that document. */
  readonly local?: { readonly from: number; readonly to: number; readonly line: number };
}

export interface SourcePanelOptions {
  /** Where to put the panel. Left out: nowhere yet; place `panel.element` yourself. */
  parent?: HTMLElement;
  catalog?: EditorCatalog | CatalogStore;
  /** Where source code comes from. Left out: the library's own, loaded on first use. */
  sources?: SourceResolver;
  theme?: ThemeChoice;
  /** Set false if the page supplies `editorStyles` itself. */
  injectStyles?: boolean;
  /** Called after the close button, or `close()`. */
  onClose?: () => void;
  /** Called whenever the panel shows something new, including by back and by links in the source. */
  onNavigate?: (target: DefinitionTarget) => void;
}

export interface SourcePanel {
  readonly element: HTMLElement;
  /** What is shown, or null when closed. */
  readonly current: DefinitionTarget | null;
  /** Shows a node type or helper. Resolves when its source has been fetched and drawn. */
  show(target: Pick<DefinitionTarget, 'kind' | 'name'> & Partial<DefinitionTarget>): Promise<void>;
  /** Goes back to what was shown before. */
  back(): Promise<void>;
  /** Hides the panel and forgets its history. */
  close(): void;
  setCatalog(catalog: EditorCatalog | CatalogStore): void;
  setTheme(theme: ThemeChoice): void;
  destroy(): void;
}

function table(rows: readonly (readonly [string, string, string])[]): HTMLElement {
  const body = el('table', 'cu-source-table');
  for (const [name, detail, description] of rows) {
    body.append(
      el('tr', undefined, [
        el('td', 'cu-doc-name', name),
        el('td', 'cu-doc-detail', detail),
        el('td', undefined, description),
      ]),
    );
  }
  return body;
}

function heading(text: string): HTMLElement {
  const node = el('div', 'cu-source-heading', text);
  node.setAttribute('role', 'heading');
  node.setAttribute('aria-level', '3');
  return node;
}

function link(text: string, href: string): HTMLAnchorElement {
  const anchor = el('a', undefined, text);
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  return anchor;
}

export function createSourcePanel(options: SourcePanelOptions = {}): SourcePanel {
  const sources = options.sources ?? builtinSources;
  let catalog: ResolvedCatalog = resolveCatalog({});
  let unsubscribe: (() => void) | null = null;
  let current: DefinitionTarget | null = null;
  const history: DefinitionTarget[] = [];
  /** Counts renders, so a slow source load cannot draw over something shown since. */
  let generation = 0;

  // Plain divs with roles, not <aside> and <h2>: a host's styles for those elements stay out.
  const element = el('div', 'cu-source-panel');
  element.setAttribute('role', 'complementary');
  element.setAttribute('aria-label', 'Source');
  element.hidden = true;
  applyTheme(element, options.theme);

  const backButton = el('button', 'cu-source-button cu-source-back', '←');
  backButton.type = 'button';
  backButton.title = 'Back';
  backButton.setAttribute('aria-label', 'Back');
  const title = el('div', 'cu-source-title');
  title.setAttribute('role', 'heading');
  title.setAttribute('aria-level', '2');
  const kind = el('span', 'cu-source-kind');
  const closeButton = el('button', 'cu-source-button cu-source-close', '×');
  closeButton.type = 'button';
  closeButton.title = 'Close';
  closeButton.setAttribute('aria-label', 'Close');
  const body = el('div', 'cu-source-body');
  element.append(
    el('div', 'cu-source-head', [
      backButton,
      title,
      kind,
      el('span', 'cu-source-spacer'),
      closeButton,
    ]),
    body,
  );

  function watch(next: EditorCatalog | CatalogStore): void {
    unsubscribe?.();
    unsubscribe = null;
    if (isCatalogStore(next)) {
      catalog = resolveCatalog(next.get());
      unsubscribe = next.subscribe((changed) => {
        catalog = resolveCatalog(changed);
      });
    } else catalog = resolveCatalog(next);
  }
  if (options.catalog) watch(options.catalog);

  /** Fills in what the caller left out from the catalog. */
  function complete(
    target: Pick<DefinitionTarget, 'kind' | 'name'> & Partial<DefinitionTarget>,
  ): DefinitionTarget {
    const type =
      target.type ?? (target.kind === 'type' ? catalog.types.get(target.name) : undefined);
    const helper =
      target.helper ?? (target.kind === 'helper' ? catalog.helpers.get(target.name) : undefined);
    return {
      kind: target.kind,
      name: target.name,
      ...(type ? { type } : {}),
      ...(helper ? { helper } : {}),
      ...(target.local ? { local: target.local } : {}),
    };
  }

  /** Source code with line numbers, where a call of a known node type is a link to that type. */
  function codeBlock(part: SourcePart, self: string): HTMLElement {
    const lines = part.code.split('\n').length;
    const gutter = el(
      'pre',
      'cu-source-gutter',
      Array.from({ length: lines }, (_, index) => String(part.line + index)).join('\n'),
    );
    gutter.setAttribute('aria-hidden', 'true');
    const code = el('code');
    const tokens = tokenize(part.code);
    tokens.forEach((token, index) => {
      if (token.type === 'plain') {
        code.append(token.text);
        return;
      }
      const span = el('span', `tok-${token.type}`, token.text);
      const called = tokens[index + 1]?.text.startsWith('(') ?? false;
      if (
        token.type === 'property' &&
        called &&
        token.text !== self &&
        catalog.types.has(token.text)
      ) {
        span.classList.add('cu-source-link');
        span.tabIndex = 0;
        span.setAttribute('role', 'link');
        span.title = `Show ${token.text}`;
        span.dataset.type = token.text;
      }
      code.append(span);
    });
    const range = el(
      'span',
      'cu-source-lines',
      part.line === part.endLine ? `line ${part.line}` : `lines ${part.line} to ${part.endLine}`,
    );
    return el('div', 'cu-source-file', [
      el('div', 'cu-source-file-head', [
        link(part.file, `${REPOSITORY_URL}${part.file}#L${part.line}-L${part.endLine}`),
        range,
      ]),
      el('div', 'cu-source-code', [gutter, el('pre', undefined, [code])]),
    ]);
  }

  function sourceSection(entry: SourceEntry | null, target: DefinitionTarget): HTMLElement[] {
    const parts: HTMLElement[] = [heading('Source')];
    if (!entry) {
      parts.push(
        el(
          'p',
          'cu-source-muted cu-source-missing',
          target.local
            ? `Defined in the script, at line ${target.local.line}.`
            : target.kind === 'type'
              ? "The source is not available: this type is not one of the library's own, so only what the host knows about it is shown."
              : "The source is not available: this helper is not one of the library's own.",
        ),
      );
      return parts;
    }
    if (entry.native.length > 0) {
      const line = el('p', 'cu-source-native', ['Built on ']);
      entry.native.forEach((name, index) => {
        if (index > 0) line.append(index === entry.native.length - 1 ? ' and ' : ', ');
        line.append(link(name, mdnUrl(name)));
      });
      line.append(entry.native.length === 1 ? ' (MDN).' : ' (MDN).');
      parts.push(line);
    }
    for (const part of entry.parts) {
      if (part.label) parts.push(el('p', 'cu-source-muted', part.label));
      parts.push(codeBlock(part, target.name));
    }
    return parts;
  }

  function typeBody(info: NodeTypeInfo): HTMLElement[] {
    const parts: HTMLElement[] = [
      el('p', 'cu-source-description', info.description),
      el('code', 'cu-source-signature', typeSignature(info)),
    ];
    const facts: string[] = [];
    if (info.shorthand) {
      const param = info.params.find((candidate) => candidate.name === info.shorthand);
      const value = param?.kind === 'number' ? formatNumber(param.default) : '...';
      facts.push(`A bare value sets ${info.shorthand}: ${info.type}(${value}).`);
    }
    if (info.triggerable) facts.push('Can be triggered.');
    if (info.modulates) facts.push(`In a chain it modulates the next node's ${info.modulates}.`);
    if (facts.length > 0) parts.push(el('p', 'cu-source-muted', facts.join(' ')));
    if (info.params.length > 0) {
      parts.push(
        heading('Parameters'),
        table(info.params.map((p) => [p.name, paramDetail(p), p.description ?? ''])),
      );
    }
    const optionRows = (record: NodeTypeInfo['options']): [string, string, string][] =>
      Object.entries(record).map(([name, option]) => [
        name,
        optionDetail(option),
        option.description,
      ]);
    if (Object.keys(info.options).length > 0) {
      parts.push(heading('Options'), table(optionRows(info.options)));
    }
    if (Object.keys(info.triggerOptions).length > 0) {
      parts.push(heading('Trigger options'), table(optionRows(info.triggerOptions)));
    }
    return parts;
  }

  function helperBody(helper: HelperInfo): HTMLElement[] {
    const parts: HTMLElement[] = [
      el('p', 'cu-source-description', helper.description),
      el('code', 'cu-source-signature', helper.signature),
    ];
    if (helper.example && helper.result) {
      parts.push(
        el('p', 'cu-source-muted', [
          el('code', undefined, helper.example),
          ' gives ',
          el('code', undefined, helper.result),
        ]),
      );
    }
    if (helper.alias) {
      parts.push(
        el('p', 'cu-source-muted', [`Also as `, el('code', undefined, helper.alias), '.']),
      );
    }
    return parts;
  }

  async function render(target: DefinitionTarget): Promise<void> {
    const mine = ++generation;
    current = target;
    element.hidden = false;
    title.textContent = target.name;
    kind.textContent =
      target.kind === 'helper' ? 'helper' : target.type ? typeKind(target.type) : 'node type';
    backButton.disabled = history.length === 0;
    const head =
      target.kind === 'type'
        ? target.type
          ? typeBody(target.type)
          : [
              el(
                'p',
                'cu-source-muted',
                `Nothing is known about a node type called ${target.name}.`,
              ),
            ]
        : target.helper
          ? helperBody(target.helper)
          : [el('p', 'cu-source-muted', `Nothing is known about a helper called ${target.name}.`)];
    const loadingNote = el('p', 'cu-source-muted cu-source-loading', 'Loading source...');
    body.replaceChildren(...head, loadingNote);
    body.scrollTop = 0;
    options.onNavigate?.(target);

    let entry: SourceEntry | null = null;
    if (!target.local) {
      try {
        // A helper is looked up by its own name, whichever name it was called by.
        entry = await sources(target.kind, target.helper?.name ?? target.name);
      } catch {
        entry = null;
      }
    }
    if (mine !== generation) return;
    loadingNote.replaceWith(...sourceSection(entry, target));
  }

  function follow(event: Event): void {
    const type = (event.target as HTMLElement | null)?.closest<HTMLElement>('.cu-source-link')
      ?.dataset.type;
    if (!type) return;
    event.preventDefault();
    void panel.show({ kind: 'type', name: type });
  }
  body.addEventListener('click', follow);
  body.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') follow(event);
  });
  backButton.addEventListener('click', () => void panel.back());
  closeButton.addEventListener('click', () => panel.close());
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') panel.close();
  });

  const panel: SourcePanel = {
    element,
    get current() {
      return current;
    },
    show(target) {
      if (options.injectStyles !== false) ensureStyles(element);
      const next = complete(target);
      if (current && (current.kind !== next.kind || current.name !== next.name)) {
        history.push(current);
      }
      return render(next);
    },
    back() {
      const previous = history.pop();
      return previous ? render(complete(previous)) : Promise.resolve();
    },
    close() {
      generation++;
      const wasOpen = current !== null;
      current = null;
      history.length = 0;
      element.hidden = true;
      body.replaceChildren();
      if (wasOpen) options.onClose?.();
    },
    setCatalog: watch,
    setTheme(theme) {
      applyTheme(element, theme);
    },
    destroy() {
      generation++;
      unsubscribe?.();
      unsubscribe = null;
      current = null;
      element.remove();
    },
  };

  if (options.parent) {
    options.parent.append(element);
    if (options.injectStyles !== false) ensureStyles(element);
  }
  return panel;
}
