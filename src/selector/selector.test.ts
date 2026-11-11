import { describe, expect, it } from 'vitest';
import { matchesCompound, parseSelector, select, SelectorError } from './index';
import type { Selectable, SelectableTree } from './index';

interface N extends Selectable {
  readonly kids: N[];
}

function node(
  id: string,
  type: string,
  classes: string[] = [],
  tags: Record<string, string | number | boolean> = {},
  kids: N[] = [],
): N {
  return { id, type, classes: new Set(classes), tags, kids };
}

// top level, in creation order:
//   osc (sine .a .b)            tags: solo, role=send, level=3
//   lp0 (lowpass)
//   poly (polysynth)
//     lpA (lowpass .inner)
//     sawA (saw)
//     voice (voice)
//       lpB (lowpass .inner)
//       sineB (sine)
//   lp1 (lowpass .wet)          tags: role="send return"
//   gain0 (gain .a)
//   poly2 (polysynth)
//     lpC (lowpass)
const lpB = node('lpB', 'lowpass', ['inner']);
const sineB = node('sineB', 'sine');
const voice = node('voice', 'voice', [], {}, [lpB, sineB]);
const lpA = node('lpA', 'lowpass', ['inner']);
const sawA = node('sawA', 'saw');
const poly = node('poly', 'polysynth', [], {}, [lpA, sawA, voice]);
const lpC = node('lpC', 'lowpass');
const poly2 = node('poly2', 'polysynth', [], {}, [lpC]);
const osc = node('osc', 'sine', ['a', 'b'], { solo: true, role: 'send', level: 3 });
const lp0 = node('lp0', 'lowpass');
const lp1 = node('lp1', 'lowpass', ['wet'], { role: 'send return' });
const gain0 = node('gain0', 'gain', ['a']);
const top: N[] = [osc, lp0, poly, lp1, gain0, poly2];

const tree: SelectableTree<N> = {
  children: (p) => (p === null ? top : p.kids),
};

const ids = (nodes: readonly N[]): string[] => nodes.map((n) => n.id);
const sel = (s: string, root: N | null = null): string[] => ids(select(s, tree, root));

describe('select: grammar forms', () => {
  const cases: [string, string[]][] = [
    ['sine', ['osc']],
    ['lowpass', ['lp0', 'lp1']],
    ['*', ['osc', 'lp0', 'poly', 'lp1', 'gain0', 'poly2']],
    ['#osc', ['osc']],
    ['#lpA', []],
    ['.a', ['osc', 'gain0']],
    ['.a.b', ['osc']],
    ['.b.a', ['osc']],
    ['sine.a', ['osc']],
    ['gain.b', []],
    ['[solo]', ['osc']],
    ['[missing]', []],
    ['[role=send]', ['osc']],
    ['[role="send return"]', ['lp1']],
    ["[role='send return']", ['lp1']],
    ['[level=3]', ['osc']],
    ['[solo=true]', ['osc']],
    ['[ role = send ]', ['osc']],
    ['[ role != send ]', ['lp0', 'poly', 'lp1', 'gain0', 'poly2']],
    ['[role!=send]', ['lp0', 'poly', 'lp1', 'gain0', 'poly2']],
    ['[nope!=x]', ['osc', 'lp0', 'poly', 'lp1', 'gain0', 'poly2']],
    ['sine.a#osc[role=send][solo]', ['osc']],
    ['sine#nope', []],
    [':not(.a)', ['lp0', 'poly', 'lp1', 'poly2']],
    ['lowpass:not(.wet)', ['lp0']],
    ['*:not(sine, gain, polysynth)', ['lp0', 'lp1']],
    ['*:not( sine , .wet )', ['lp0', 'poly', 'gain0', 'poly2']],
    ['*:not(.a):not(lowpass)', ['poly', 'poly2']],
    ['lowpass:not([role])', ['lp0']],
    ['lowpass:nth(0)', ['lp0']],
    ['lowpass:nth(1)', ['lp1']],
    ['lowpass:nth(2)', []],
    ['*:nth(2)', ['poly']],
    ['lowpass:not(.wet):nth(0)', ['lp0']],
    ['lowpass:not(.wet):nth(1)', []],
    ['  sine  ', ['osc']],
  ];
  it.each(cases)('%j', (selector, expected) => {
    expect(sel(selector)).toEqual(expected);
  });

  it('numeric-leading ids and classes', () => {
    const a = node('12', 'x', ['track-3', '9']);
    const t: SelectableTree<N> = { children: (p) => (p === null ? [a] : []) };
    expect(ids(select('#12', t))).toEqual(['12']);
    expect(ids(select('.track-3', t))).toEqual(['12']);
    expect(ids(select('.9', t))).toEqual(['12']);
    expect(ids(select('x-y, x', t))).toEqual(['12']);
  });
});

describe('select: scope and combinators', () => {
  const cases: [string, string[]][] = [
    ['lowpass', ['lp0', 'lp1']],
    ['*', ['osc', 'lp0', 'poly', 'lp1', 'gain0', 'poly2']],
    ['polysynth lowpass', ['lpA', 'lpB', 'lpC']],
    ['polysynth > lowpass', ['lpA', 'lpC']],
    ['polysynth>lowpass', ['lpA', 'lpC']],
    ['polysynth >lowpass', ['lpA', 'lpC']],
    ['polysynth> lowpass', ['lpA', 'lpC']],
    ['polysynth   >   lowpass', ['lpA', 'lpC']],
    ['polysynth *', ['lpA', 'sawA', 'voice', 'lpB', 'sineB', 'lpC']],
    ['polysynth > *', ['lpA', 'sawA', 'voice', 'lpC']],
    ['polysynth voice lowpass', ['lpB']],
    ['polysynth > voice > lowpass', ['lpB']],
    ['polysynth > lowpass > lowpass', []],
    ['polysynth sine', ['sineB']],
    ['polysynth > sine', []],
    ['lowpass lowpass', []],
    ['gain lowpass', []],
    ['polysynth:nth(0) lowpass', ['lpA', 'lpB']],
    ['polysynth:nth(1) lowpass', ['lpC']],
    ['polysynth:nth(2) lowpass', []],
    ['polysynth lowpass:nth(0)', ['lpA']],
    ['polysynth lowpass:nth(2)', ['lpC']],
    ['polysynth > lowpass:nth(1)', ['lpC']],
    ['polysynth *:nth(3)', ['lpB']],
    ['polysynth .inner', ['lpA', 'lpB']],
    ['polysynth lowpass:not(.inner)', ['lpC']],
    ['#poly lowpass', ['lpA', 'lpB']],
    ['#lpA', []],
    ['#poly #lpB', ['lpB']],
  ];
  it.each(cases)('%j', (selector, expected) => {
    expect(sel(selector)).toEqual(expected);
  });

  it('descendant and child differ at depth 2', () => {
    expect(sel('polysynth lowpass')).toContain('lpB');
    expect(sel('polysynth > lowpass')).not.toContain('lpB');
    expect(sel('polysynth > voice > lowpass')).toEqual(['lpB']);
  });

  it('de-duplicates nodes reachable through several parents', () => {
    expect(sel('polysynth lowpass')).toEqual(['lpA', 'lpB', 'lpC']);
    expect(sel('* lowpass')).toEqual(['lpA', 'lpB', 'lpC']);
    expect(sel('polysynth voice *')).toEqual(['lpB', 'sineB']);
    expect(sel('polysynth * lowpass')).toEqual(['lpB']);
  });

  it('child step keeps document order when previous results are nested', () => {
    // previous set is [poly, voice] (via `polysynth, voice` style nesting): use '* > *' on poly.
    expect(sel('polysynth *:not(voice) > *')).toEqual([]);
    expect(sel('polysynth > * > *')).toEqual(['lpB', 'sineB']);
    expect(sel('* > *')).toEqual(['lpA', 'sawA', 'voice', 'lpC']);
  });
});

describe('select: lists', () => {
  const cases: [string, string[]][] = [
    ['sine, saw', ['osc']],
    ['sine,gain', ['osc', 'gain0']],
    ['  sine ,  gain  ', ['osc', 'gain0']],
    ['gain, sine', ['osc', 'gain0']],
    ['.a, sine', ['osc', 'gain0']],
    ['lowpass, #lp0, .wet', ['lp0', 'lp1']],
    ['polysynth lowpass, polysynth > lowpass', ['lpA', 'lpB', 'lpC']],
    ['polysynth sine, polysynth saw, polysynth voice', ['sawA', 'voice', 'sineB']],
    ['gain, polysynth > lowpass, sine', ['osc', 'lpA', 'gain0', 'lpC']],
  ];
  it.each(cases)('%j', (selector, expected) => {
    expect(sel(selector)).toEqual(expected);
  });

  it('merges top-level and nested matches in document order', () => {
    expect(sel('polysynth lowpass, lowpass')).toEqual(['lp0', 'lpA', 'lpB', 'lp1', 'lpC']);
  });
});

describe('select: root', () => {
  it('root = macro node: step 0 is its direct children', () => {
    expect(sel('lowpass', poly)).toEqual(['lpA']);
    expect(sel('*', poly)).toEqual(['lpA', 'sawA', 'voice']);
    expect(sel('voice lowpass', poly)).toEqual(['lpB']);
    expect(sel('lowpass:nth(0)', poly)).toEqual(['lpA']);
    expect(sel('sine', poly)).toEqual([]);
    expect(sel('sine', voice)).toEqual(['sineB']);
    expect(sel('lowpass, sine', voice)).toEqual(['lpB', 'sineB']);
    expect(sel('#lpB', poly)).toEqual([]);
    expect(sel('voice > lowpass', poly)).toEqual(['lpB']);
    expect(sel('*', lpC)).toEqual([]);
  });
});

describe('matchesCompound', () => {
  it('positive', () => {
    expect(matchesCompound(osc, 'sine')).toBe(true);
    expect(matchesCompound(osc, '*')).toBe(true);
    expect(matchesCompound(osc, '.a.b[role=send]#osc')).toBe(true);
    expect(matchesCompound(osc, 'saw, sine')).toBe(true);
    expect(matchesCompound(lp0, ':not(.wet)')).toBe(true);
    expect(matchesCompound(lp0, '[role!=send]')).toBe(true);
    expect(matchesCompound(lpB, parseSelector('lowpass.inner'))).toBe(true);
  });
  it('negative', () => {
    expect(matchesCompound(osc, 'saw')).toBe(false);
    expect(matchesCompound(osc, '.c')).toBe(false);
    expect(matchesCompound(osc, ':not(sine)')).toBe(false);
    expect(matchesCompound(osc, '[role=other]')).toBe(false);
    expect(matchesCompound(osc, '#nope, gain')).toBe(false);
  });
  it('throws on combinators', () => {
    for (const s of ['a b', 'a > b', 'a, b c']) {
      expect(() => matchesCompound(osc, s)).toThrow(SelectorError);
    }
    try {
      matchesCompound(osc, 'a > b');
    } catch (e) {
      expect((e as SelectorError).position).toBe(2);
    }
  });
  it('throws on :nth', () => {
    expect(() => matchesCompound(osc, 'sine:nth(0)')).toThrow(SelectorError);
    try {
      matchesCompound(osc, 'sine:nth(0)');
    } catch (e) {
      expect((e as SelectorError).position).toBe(4);
    }
  });
  it('throws on invalid selectors', () => {
    expect(() => matchesCompound(osc, '')).toThrow(SelectorError);
  });
});

describe('parseSelector', () => {
  it('caches per source string', () => {
    const a = parseSelector('polysynth > lowpass:nth(1)');
    expect(parseSelector('polysynth > lowpass:nth(1)')).toBe(a);
    expect(parseSelector('polysynth > lowpass:nth(1) ')).not.toBe(a);
  });
  it('select accepts a parsed list', () => {
    expect(ids(select(parseSelector('sine'), tree))).toEqual(['osc']);
  });
  it('builds a readable AST', () => {
    const list = parseSelector('sampler.kick#a[role=x]:not(.muted):nth(0) > *');
    expect(list.source).toBe('sampler.kick#a[role=x]:not(.muted):nth(0) > *');
    const steps = list.selectors[0]?.steps ?? [];
    expect(steps).toHaveLength(2);
    const c = steps[0]?.compound;
    expect(c?.type).toBe('sampler');
    expect(c?.classes).toEqual(['kick']);
    expect(c?.ids).toEqual(['a']);
    expect(c?.tags).toEqual([{ op: 'equals', name: 'role', value: 'x' }]);
    expect(c?.not[0]?.[0]?.classes).toEqual(['muted']);
    expect(c?.nth).toBe(0);
    expect(steps[1]?.combinator).toBe('child');
    expect(steps[1]?.compound.universal).toBe(true);
  });
  it('does not cache failures as successes', () => {
    expect(() => parseSelector('a,,b')).toThrow(SelectorError);
    expect(() => parseSelector('a,,b')).toThrow(SelectorError);
  });
});

describe('invalid selectors', () => {
  const cases: [string, number][] = [
    ['', 0],
    ['  ', 2],
    ['#', 1],
    ['.', 1],
    ['a#', 2],
    ['[a', 2],
    ['[', 1],
    ['[a=]', 3],
    ['[a="x]', 3],
    ['[a=b', 4],
    ['[1a]', 1],
    ['a,,b', 2],
    ['a,', 2],
    [',a', 0],
    ['a >', 3],
    ['> a', 0],
    ['a > > b', 4],
    ['a >, b', 3],
    [':not()', 5],
    [':not(a b)', 7],
    [':not(a > b)', 7],
    [':not(:not(a))', 5],
    [':not(a:nth(0))', 6],
    [':not', 4],
    [':not(a', 6],
    [':nth(-1)', 5],
    [':nth(x)', 5],
    [':nth()', 5],
    [':nth(1', 6],
    [':nth(0):nth(1)', 7],
    ['a:unknown', 1],
    ['a:', 1],
    ['a*', 1],
    ['*a', 1],
    ['a b*', 3],
    ['**', 1],
    ['9type', 0],
    ['-a', 0],
    ['a$', 1],
    ['a(b)', 1],
  ];
  it.each(cases)('%j fails at position %i', (source, position) => {
    let error: unknown;
    try {
      parseSelector(source);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SelectorError);
    expect(error).toBeInstanceOf(Error);
    const err = error as SelectorError;
    expect(err.source).toBe(source);
    expect(err.position).toBe(position);
    expect(err.message.length).toBeGreaterThan(10);
  });

  it('messages name what was expected', () => {
    expect(() => parseSelector('[a=]')).toThrow(/Expected a value/);
    expect(() => parseSelector('#')).toThrow(/Expected an id name/);
    expect(() => parseSelector('a >')).toThrow(/Expected a selector after '>'/);
    expect(() => parseSelector('a:unknown')).toThrow(/:not\(\.\.\.\) or :nth\(n\)/);
  });

  it('select throws SelectorError for a bad string', () => {
    expect(() => select('', tree)).toThrow(SelectorError);
  });
});
