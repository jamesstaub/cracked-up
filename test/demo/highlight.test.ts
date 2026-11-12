import { describe, expect, it } from 'vitest';
import { exampleFor } from '../../demo/examples';
import { highlightInto, tokenize } from '../../demo/highlight';
import type { Token } from '../../demo/highlight';
import { offlineEngine } from '../core/setup';

const text = (tokens: readonly Token[]) => tokens.map((token) => token.text).join('');
/** The tokens that are not plain text, as `type:text`. */
const marked = (source: string) =>
  tokenize(source)
    .filter((token) => token.type !== 'plain')
    .map((token) => `${token.type}:${token.text}`);

const STARTER = `// Edit this code: it re-runs on every key up.
__.transport.bpm = 110;
__.bus('drums');
__().sampler({ id: 'kick', buffer: 'kick' }).to('drums');
__.transport.sequence('hat', { steps: euclid(5, 8), step: '1/8', swing: 0.58 }, (ev) => {
  if (ev.value && ev.bar % 8 >= 2) __('#hat').trigger({ speed: 1 + ev.index * 0.04 });
});
define({ type: 'blip', params: { pitch: { default: 660, min: 50 } }, build(__) {} });
`;

const AWKWARD = [
  '',
  ' ',
  '\n\n',
  STARTER,
  `'unterminated`,
  `"unterminated\nnext('line')`,
  `'ends with a backslash\\`,
  '`unterminated template ${',
  '`unterminated ${ a + `nested ${b',
  '`a ${ { b: `c ${d}` }.b } e` + 1',
  '/* unterminated comment',
  '/* a */ b /* c */',
  '// only a comment',
  'a / b / c',
  'const half = total / 2; const re = /[/\\]]+/gi;',
  'x = /unterminated regex',
  'return /a\\/b/.test(s) ? 1 / 2 : 3',
  '(ev) => ev.value >= 2 ? a : b',
  '() => /=>/',
  '0x1F + 1_000n + .5 + 1e-3 + 1.5.toFixed(2)',
  'a?.b ?? c; f(...args); obj.default; obj.class',
  '<div class="x">&amp;</div> <script>alert(1)</script>',
  'emoji \u{1F600} = "\u{1F600}"; café = 1',
  '}}}} ${ ` \\',
  '\t\ttabs\r\nand carriage returns\r\n',
];

describe('highlight: tokenize', () => {
  it('gives back the source exactly, whatever the input', () => {
    for (const source of AWKWARD) expect(text(tokenize(source))).toBe(source);
  });

  it('gives back the source for every prefix of the starter code, as when typing it', () => {
    for (let length = 0; length <= STARTER.length; length++) {
      const source = STARTER.slice(0, length);
      expect(text(tokenize(source))).toBe(source);
    }
  });

  it('gives back the source for every generated docs example', async () => {
    const types = (await offlineEngine(0.01)).registry.list();
    for (const info of types) {
      const source = exampleFor(info);
      expect(text(tokenize(source))).toBe(source);
    }
  });

  it('never makes an empty token', () => {
    for (const source of AWKWARD) {
      expect(tokenize(source).every((token) => token.text.length > 0)).toBe(true);
    }
  });

  it('marks comments, strings, numbers, keywords, __ and names after a dot', () => {
    expect(marked(`const x = __('#a').set({ gain: 0.5 }); // done`)).toEqual([
      'keyword:const',
      'dunder:__',
      "string:'#a'",
      'property:set',
      'number:0.5',
      'comment:// done',
    ]);
    expect(marked('/* a */ "b" `c` true null')).toEqual([
      'comment:/* a */',
      'string:"b"',
      'string:`c`',
      'literal:true',
      'literal:null',
    ]);
  });

  it('reads the code inside a template substitution as code', () => {
    expect(marked('`a ${__.x + 1} b`')).toEqual([
      'string:`a ',
      'dunder:__',
      'property:x',
      'number:1',
      'string: b`',
    ]);
  });

  it('tells a regular expression from a division', () => {
    expect(marked('a / 2 / b')).toEqual(['number:2']);
    expect(marked('x = /a\\/[/]b/g')).toEqual(['regex:/a\\/[/]b/g']);
    expect(marked('f(1) / 2')).toEqual(['number:1', 'number:2']);
    expect(marked('ev.bar % 8 / 2 // half')).toEqual([
      'property:bar',
      'number:8',
      'number:2',
      'comment:// half',
    ]);
  });

  it('ends an unterminated string with its line', () => {
    expect(marked(`'open\nlet`)).toEqual(["string:'open", 'keyword:let']);
  });

  it('treats a keyword as a plain name when it is an object key or a property', () => {
    expect(marked(`({ default: 1, class: 'a' }).default`)).toEqual([
      'number:1',
      "string:'a'",
      'property:default',
    ]);
    expect(marked('switch (a) { case 1: break; default: }')).toEqual([
      'keyword:switch',
      'keyword:case',
      'number:1',
      'keyword:break',
      'keyword:default',
    ]);
    expect(marked('f(...args)')).toEqual([]);
  });
});

describe('highlight: highlightInto', () => {
  it('keeps textContent equal to the source and never reads code as HTML', () => {
    const target = document.createElement('code');
    for (const source of AWKWARD) {
      highlightInto(target, source);
      expect(target.textContent).toBe(source);
      expect(target.querySelector('div, script')).toBeNull();
      for (const child of target.children) {
        expect(child.tagName).toBe('SPAN');
        expect(child.className).toMatch(/^tok-[a-z]+$/);
        expect(child.children.length).toBe(0);
      }
    }
  });
});
