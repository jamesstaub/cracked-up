/**
 * JavaScript syntax highlighting for the demo and docs pages, with no dependency.
 *
 * `tokenize` splits source into tokens whose text, joined, is exactly the source: nothing is dropped,
 * added or reordered, whatever the input (half-typed code included). The rest of the module turns
 * tokens into DOM. It only ever makes text nodes and sets `textContent`, so code is never read as HTML.
 */

export type TokenType =
  | 'plain'
  | 'comment'
  | 'string'
  | 'regex'
  | 'number'
  | 'keyword'
  | 'literal'
  | 'dunder'
  | 'property';

export interface Token {
  readonly type: TokenType;
  readonly text: string;
}

const KEYWORDS = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'of',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

/** Keywords after which a slash starts a regular expression, not a division. */
const REGEX_AFTER_KEYWORD = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

const IDENTIFIER = /[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*/uy;
const NUMBER =
  /0[xX][\da-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?/y;
const WHITESPACE = /\s+/y;
/** A regular expression literal on one line: a body in which classes may hold slashes, then flags. */
const REGEX = /\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[A-Za-z]*/y;

function matchAt(pattern: RegExp, source: string, index: number): string | null {
  pattern.lastIndex = index;
  return pattern.exec(source)?.[0] ?? null;
}

class Scanner {
  readonly tokens: Token[] = [];
  /** The last token that was not whitespace or a comment: what decides how `/`, `.name` and `key:` read. */
  private previous: Token | null = null;

  constructor(private readonly source: string) {}

  private push(type: TokenType, text: string, significant = true): void {
    if (text === '') return;
    const token = { type, text };
    const last = this.tokens[this.tokens.length - 1];
    // Neighbouring plain text becomes one token, so the page gets fewer nodes.
    if (type === 'plain' && last?.type === 'plain') {
      this.tokens[this.tokens.length - 1] = { type, text: last.text + text };
    } else this.tokens.push(token);
    if (significant) this.previous = token;
  }

  /** Whether the last significant token is exactly one of these pieces of punctuation. */
  private previousIs(...texts: string[]): boolean {
    return this.previous?.type === 'plain' && texts.includes(this.previous.text);
  }

  /** Whether a slash here would start a regular expression (true) or be a division (false). */
  private regexAllowed(): boolean {
    const previous = this.previous;
    if (!previous) return true;
    if (previous.type === 'keyword') return REGEX_AFTER_KEYWORD.has(previous.text);
    if (previous.type !== 'plain') return false;
    // After a name, a closing bracket or a number comes an operator. After other punctuation, a value.
    return !/[\p{ID_Continue}$)\]}]$/u.test(previous.text);
  }

  /**
   * Reads from `start`. With `inSubstitution`, stops after the `}` that closes a template's `${`.
   * Returns the index reached.
   */
  scan(start: number, inSubstitution: boolean): number {
    const source = this.source;
    let depth = 0;
    let i = start;
    while (i < source.length) {
      const char = source[i]!;
      const next = source[i + 1];

      const space = matchAt(WHITESPACE, source, i);
      if (space !== null) {
        this.push('plain', space, false);
        i += space.length;
      } else if (char === '/' && next === '/') {
        const end = source.indexOf('\n', i);
        const stop = end === -1 ? source.length : end;
        this.push('comment', source.slice(i, stop), false);
        i = stop;
      } else if (char === '/' && next === '*') {
        const end = source.indexOf('*/', i + 2);
        const stop = end === -1 ? source.length : end + 2;
        this.push('comment', source.slice(i, stop), false);
        i = stop;
      } else if (char === '"' || char === "'") {
        const stop = this.quotedEnd(i, char);
        this.push('string', source.slice(i, stop));
        i = stop;
      } else if (char === '`') {
        i = this.template(i);
      } else if (char === '/' && this.regexAllowed() && matchAt(REGEX, source, i) !== null) {
        const text = matchAt(REGEX, source, i)!;
        this.push('regex', text);
        i += text.length;
      } else if (
        (char >= '0' && char <= '9') ||
        (char === '.' && next !== undefined && next >= '0' && next <= '9')
      ) {
        const text = matchAt(NUMBER, source, i) ?? char;
        this.push('number', text);
        i += text.length;
      } else {
        const name = matchAt(IDENTIFIER, source, i);
        if (name !== null) {
          this.push(this.nameType(name, i + name.length), name);
          i += name.length;
        } else {
          if (inSubstitution) {
            if (char === '{') depth++;
            else if (char === '}' && depth-- === 0) {
              this.push('plain', char);
              return i + 1;
            }
          }
          // A spread is one token, so the name after it is not taken for a property. Otherwise one
          // whole code point, so a character outside the basic plane is never split in two.
          const point = source.startsWith('...', i)
            ? '...'
            : String.fromCodePoint(source.codePointAt(i)!);
          this.push('plain', point);
          i += point.length;
        }
      }
    }
    return i;
  }

  private nameType(name: string, end: number): TokenType {
    // After a dot, any word is a property name: `.default`, `.in`, `.class`.
    if (this.previousIs('.')) return 'property';
    if (name === '__') return 'dunder';
    if (LITERALS.has(name)) return 'literal';
    if (KEYWORDS.has(name)) {
      // `{ default: 660 }` and `, class: 'drums'` are object keys, not keywords.
      const isKey = /^\s*:/.test(this.source.slice(end, end + 40));
      if (isKey && this.previousIs('{', ',')) return 'plain';
      return 'keyword';
    }
    return 'plain';
  }

  /** The index after a quoted string's closing quote. A string left open ends with its line. */
  private quotedEnd(start: number, quote: string): number {
    const source = this.source;
    let i = start + 1;
    while (i < source.length) {
      const char = source[i];
      if (char === '\\') i += 2;
      else if (char === quote) return i + 1;
      else if (char === '\n') return i;
      else i++;
    }
    return Math.min(i, source.length);
  }

  /** A template literal: its text is string, and the code inside each `${ }` is read as code. */
  private template(start: number): number {
    const source = this.source;
    let i = start + 1;
    let chunk = start;
    while (i < source.length) {
      const char = source[i];
      if (char === '\\') i += 2;
      else if (char === '`') {
        this.push('string', source.slice(chunk, i + 1));
        return i + 1;
      } else if (char === '$' && source[i + 1] === '{') {
        this.push('string', source.slice(chunk, i));
        this.push('plain', '${');
        i = this.scan(i + 2, true);
        chunk = i;
      } else i++;
    }
    // Never closed: the rest of the source is the template.
    this.push('string', source.slice(chunk, source.length));
    return source.length;
  }
}

/** Splits JavaScript source into tokens. Joining every token's `text` gives back `source` exactly. */
export function tokenize(source: string): Token[] {
  const scanner = new Scanner(source);
  scanner.scan(0, false);
  return scanner.tokens;
}

/** Replaces what `target` holds with highlighted `source`. `target.textContent` is then `source`. */
export function highlightInto(target: Element, source: string): void {
  const nodes = tokenize(source).map((token) => {
    if (token.type === 'plain') return document.createTextNode(token.text);
    const span = document.createElement('span');
    span.className = `tok-${token.type}`;
    span.textContent = token.text;
    return span;
  });
  target.replaceChildren(...nodes);
}

/**
 * Highlights every `<pre><code>` under `root`. A block that is not JavaScript says so with `data-lang`
 * (`"text"`, `"html"`) on its `<pre>` or `<code>`, and is left as it is.
 */
export function highlightBlocks(root: ParentNode = document): void {
  for (const block of root.querySelectorAll<HTMLElement>('pre > code')) {
    const lang = block.dataset.lang ?? block.parentElement?.dataset.lang ?? 'js';
    if (lang !== 'js' && lang !== 'javascript') continue;
    highlightInto(block, block.textContent ?? '');
  }
}

/**
 * Shows highlighted code behind a textarea. The textarea stays the thing that is typed into; its own
 * text is made transparent by the stylesheet, and `layer` (a `<pre>` holding one `<code>`, placed
 * exactly under it) shows the same text in colour.
 *
 * Returns a function that redraws the layer. Typing and scrolling redraw by themselves; call it after
 * changing the text from code (`editor.value = ...`, `setRangeText`), which fires no event.
 */
export function attachHighlighter(editor: HTMLTextAreaElement, layer: HTMLElement): () => void {
  const code = layer.querySelector('code') ?? layer.appendChild(document.createElement('code'));
  let shown: string | null = null;

  // The layer does not scroll: its content is moved instead. A textarea's scroll range depends on its
  // scrollbars, so two scrolling boxes can disagree near the ends; a transform cannot.
  const follow = (): void => {
    code.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
  };
  const refresh = (): void => {
    if (editor.value !== shown) {
      shown = editor.value;
      highlightInto(code, shown);
    }
    follow();
  };

  editor.addEventListener('input', refresh);
  // For code that sets the value and then sends a key event, as scripts driving the page do.
  editor.addEventListener('keyup', refresh);
  editor.addEventListener('scroll', follow);
  refresh();
  return refresh;
}
