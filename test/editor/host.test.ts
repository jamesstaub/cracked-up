import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  catalogFromEngine,
  catalogFromRemoteState,
  catalogFromScope,
  catalogFromSnapshot,
  createCatalogStore,
  createEditor,
  diagnosticsAt,
  hoverAt,
  resolveCatalog,
  signatureAt,
} from '../../src/editor';
import type {
  CursorInfo,
  Editor,
  EditorCatalog,
  FunctionInfo,
  OptionKeyInfo,
  ResolvedCatalog,
  ReturnInfo,
} from '../../src/editor';
import { renderDoc } from '../../src/editor/docs';
import { offlineEngine } from '../core/setup';
import { labelsAt, resultAt, stateAt, testCatalog, testEngine } from './setup';

// A host's own functions, as it would describe them: a dial for a parameter of some nodes or a
// value of its own, a panel of dials for some nodes, and a grid for a sequence.

const DIAL: ReturnInfo = {
  name: 'dial',
  description: 'Returns the dial.',
  members: [
    { name: 'value', description: 'Where the dial is now.' },
    { name: 'set', signature: 'set(value)', description: 'Moves the dial.' },
    { name: 'param', description: 'The parameter it moves.', returns: 'param' },
  ],
};

const DIAL_OPTIONS: readonly OptionKeyInfo[] = [
  { name: 'label', description: 'What it is called on screen.', type: 'string' },
  { name: 'mode', description: 'How it reads.', values: ['midi', 'db'], default: "'midi'" },
  { name: 'steps', description: 'How many stops.', values: [4, 8] },
  { name: 'fine', description: 'Whether it moves slowly.', kind: 'boolean' },
  { name: 'send', description: 'Where it also goes.', kind: 'bus' },
  { name: 'follow', description: 'Another parameter it tracks.', kind: 'param', of: 'target' },
];

const FUNCTIONS: readonly FunctionInfo[] = [
  {
    name: 'dial',
    description: 'Shows a dial for a parameter.',
    signatures: [
      {
        args: [
          { name: 'target', kind: 'selector', description: 'Which nodes.' },
          { name: 'param', kind: 'param', of: 'target', description: 'Which parameter.' },
          { name: 'options', kind: 'options', optional: true, options: DIAL_OPTIONS },
        ],
        returns: DIAL,
      },
      {
        description: 'A dial with a value of its own.',
        args: [
          { name: 'name', kind: 'name', description: 'What to call it.' },
          {
            name: 'range',
            kind: 'options',
            options: [
              { name: 'min', type: 'number' },
              { name: 'max', type: 'number' },
            ],
          },
        ],
        returns: DIAL,
      },
    ],
  },
  {
    name: 'panel',
    description: 'Shows a dial for each parameter.',
    signatures: [
      {
        args: [
          { name: 'target', kind: 'selector', optional: true },
          {
            name: 'names',
            kind: 'list',
            optional: true,
            items: { kind: 'param', of: 'target' },
          },
        ],
      },
    ],
  },
  {
    name: 'grid',
    description: 'Shows a sequence as a grid.',
    signatures: [
      {
        args: [
          { name: 'sequence', kind: 'sequence' },
          { name: 'out', kind: 'bus', optional: true },
          { name: 'sound', kind: 'buffer', optional: true },
          { name: 'anything', kind: 'value', optional: true },
        ],
        returns: { kind: 'sequence' },
      },
    ],
  },
];

const HOST: EditorCatalog = {
  functions: FUNCTIONS,
  ids: ['plain', { name: 'lead', type: 'saw', description: 'The lead voice.' }, { name: 'odd' }],
  buses: ['fx', { name: 'verb', description: 'The shared reverb.' }],
  sequences: [{ name: 'intro', description: 'Plays once at the start.' }, 'outro'],
};

let catalog: ResolvedCatalog;
let base: EditorCatalog;
beforeAll(async () => {
  catalog = await testCatalog(HOST);
  base = catalog.source;
});

const labels = (code: string, explicit = false): string[] =>
  labelsAt(code, catalog, explicit) ?? [];
const hover = (code: string, using = catalog) => {
  const { state, pos } = stateAt(code);
  return hoverAt(state, pos, using)?.doc ?? null;
};
const signature = (code: string) => {
  const { state, pos } = stateAt(code);
  return signatureAt(state, pos, catalog)?.doc ?? null;
};
/** The documentation a completion would show beside it, as text. */
const infoOf = (code: string, label: string): string | null => {
  const option = resultAt(code, catalog).result?.options.find((o) => o.label === label);
  return option?.info ? ((option.info as () => Node)().textContent ?? '') : null;
};

describe('a host function’s arguments', () => {
  it('completes a selector argument like the string in __()', () => {
    const found = labels("__().saw({ id: 'bass', class: 'voice' });\ndial('|')");
    expect(found.slice(0, 4)).toEqual(['#bass', '#plain', '#lead', '#odd']);
    expect(found).toContain('.voice');
    expect(found).toContain('lowpass');
    expect(labels("dial('#le|')")).toContain('#lead');
  });

  it('leaves an argument that is not a string alone', () => {
    // A variable or a call where the selector goes: names as anywhere, and nothing of its own.
    expect(labels('const kick = __().sampler();\ndial(ki|')).toEqual(labels('ki|'));
    expect(labelsAt('dial(|', catalog)).toBeNull();
    expect(labels('dial(__.|')).toEqual(['transport', 'bus', 'scope']);
  });

  it('completes a parameter name from what the selector matches', () => {
    // An id the script gives.
    const own = labels("__().lowpass({ id: 'f' });\ndial('#f', '|')");
    expect(own).toEqual(['frequency', 'q']);
    // A class the script gives, and a type.
    expect(labels("__().lowpass({ class: 'c' }).saw({ class: 'c' });\ndial('.c', '|')")).toEqual(
      expect.arrayContaining(['frequency', 'q', 'detune']),
    );
    expect(labels("dial('lowpass', 'fr|')")).toEqual(['frequency', 'q']);
    // An id only the host knows, with the type it gave.
    expect(labels("dial('#lead', '|')")).toEqual(labels("dial('saw', '|')"));
    expect(labels("dial('#lead', '|')")).toContain('detune');
    expect(labels("dial('#lead', '|')")).not.toContain('q');
  });

  it('offers every parameter name when the nodes cannot be worked out', () => {
    for (const code of ["dial('#plain', '|')", "dial('#nobody', '|')", "dial(something, '|')"]) {
      const found = labels(code);
      expect(found, code).toContain('frequency');
      expect(found, code).toContain('q');
      expect(found, code).toContain('feedback');
    }
  });

  it('takes the node types from a variable holding a chain or a selection', () => {
    const chain = "const kick = __().sampler({ buffer: 'kick' }).lowpass(400).to('main');\n";
    const found = labels(`${chain}dial(kick, '|')`);
    expect(found).toEqual(expect.arrayContaining(['speed', 'start', 'frequency', 'q']));
    expect(found).not.toContain('detune');
    expect(labels(`${chain}dial(kick.nodes.filter('lowpass'), '|')`)).toEqual(['frequency', 'q']);
    expect(labels(`${chain}dial(kick.tail, '|')`)).toEqual(['frequency', 'q']);
    expect(labels("const f = __('lowpass');\ndial(f, '|')")).toEqual(['frequency', 'q']);
    expect(labels("dial(__().saw().gain(0.2), '|')")).toEqual(
      expect.arrayContaining(['frequency', 'detune', 'gain']),
    );
  });

  it('offers a bus’s one parameter when the target is a bus', () => {
    expect(labels("dial(__.bus('drums'), '|')")).toEqual(['gain']);
    expect(labels("const drums = __.bus('drums');\ndial(drums, '|')")).toEqual(['gain']);
    expect(infoOf("dial(__.bus('drums'), '|')", 'gain')).toContain('level of the bus');
  });

  it('completes sequence, bus and buffer names, and nothing in a name or a value', () => {
    const made = "__.transport.sequence('beat', { steps: 4 }, () => {});\n";
    expect(labels(`${made}grid('|')`)).toEqual(['beat', 'intro', 'outro']);
    expect(labels("__.bus('drums');\ngrid('beat', '|')")).toEqual(['main', 'drums', 'fx', 'verb']);
    expect(labels("grid('beat', 'main', '|')")).toEqual(['kick', 'hat', 'break']);
    expect(labelsAt("grid('beat', 'main', 'kick', '|')", catalog)).toBeNull();
    // The first argument of the second way of calling dial is a name of the script's own.
    expect(labelsAt("dial('|', { min: 0 })", catalog)).toBeNull();
  });

  it('completes the items of a list argument', () => {
    const code = "__().sampler({ id: 'kick' });\n";
    expect(labels(`${code}panel('#kick', ['|'])`)).toEqual(labels("panel('sampler', ['|'])"));
    expect(labels(`${code}panel('#kick', ['speed', 'st|'])`)).toContain('start');
    expect(labels(`${code}panel('#kick', ['|'])`)).not.toContain('q');
    // A string where the list should be is not an item of it.
    expect(labelsAt("panel('#kick', '|')", catalog)).toBeNull();
    // A list where the library takes none offers nothing.
    expect(labelsAt("__().saw().to(['|'])", catalog)).toBeNull();
  });

  it('completes the keys of an options argument, without the ones already there', () => {
    expect(labels("dial('#f', 'frequency', { | })")).toEqual([
      'label',
      'mode',
      'steps',
      'fine',
      'send',
      'follow',
    ]);
    expect(labels("dial('#f', 'frequency', { mode: 'db', l| })")).not.toContain('mode');
    expect(infoOf("dial('#f', 'frequency', { | })", 'mode')).toContain('How it reads.');
    const { result } = resultAt("dial('#f', 'frequency', { | })", catalog);
    expect(result?.options.find((o) => o.label === 'mode')?.detail).toBe(
      "'midi' | 'db' · default 'midi'",
    );
    // No keys where the argument is not an options object.
    expect(labelsAt("dial({ | }, 'frequency')", catalog)).toBeNull();
  });

  it('completes the values of an option, in and out of quotes', () => {
    expect(labels("dial('#f', 'frequency', { mode: | })")).toEqual(["'midi'", "'db'"]);
    expect(labels("dial('#f', 'frequency', { mode: '|' })")).toEqual(['midi', 'db']);
    expect(labels("dial('#f', 'frequency', { steps: | })")).toEqual(['4', '8']);
    expect(labels("dial('#f', 'frequency', { fine: | })")).toEqual(['true', 'false']);
    expect(labelsAt("dial('#f', 'frequency', { fine: '|' })", catalog)).toBeNull();
    expect(labels("dial('#f', 'frequency', { send: '|' })")).toEqual(['main', 'fx', 'verb']);
    expect(labels("dial('lowpass', 'frequency', { follow: '|' })")).toEqual(['frequency', 'q']);
  });

  it('chooses the way of calling by the shape of the arguments', () => {
    // A string second: a parameter. An object second: the range of a dial of its own.
    expect(labels("dial('lowpass', '|')")).toEqual(['frequency', 'q']);
    expect(labels("dial('density', { | })")).toEqual(['min', 'max']);
    expect(labels("dial('density', { m|")).toEqual(['min', 'max']);
    expect(labels("dial('density', { min: 0, | })")).toEqual(['max']);
    expect(signature("dial('density', { min: 0| })")?.signature).toBe('dial(name, range)');
    expect(signature("dial('density', |")?.signature).toBe('dial(target, param, options?)');
    expect(signature("dial('#f', 'q', { | })")?.signature).toBe('dial(target, param, options?)');
  });

  it('stands aside for a function of the same name that the script declares', () => {
    const own = 'function dial(a, b) {}\n';
    expect(labelsAt(`${own}dial('|')`, catalog)).toBeNull();
    expect(signature(`${own}dial(|)`)).toBeNull();
    expect(hover(`${own}di|al('x')`)).toBeNull();
  });
});

describe('a host function’s documentation', () => {
  it('is offered by name with its arguments, once', () => {
    const withGlobal = resolveCatalog({
      ...base,
      globals: [{ name: 'dial', signature: 'dial(old)', description: 'The old way.' }],
    });
    const { result } = resultAt('di|', withGlobal);
    const found = result?.options.filter((option) => option.label === 'dial') ?? [];
    expect(found).toHaveLength(1);
    expect(found[0]?.detail).toBe('(target, param, options?)');
    expect((found[0]?.info as () => Node)().textContent).toContain('Shows a dial for a parameter.');
  });

  it('shows on hover: every way of calling it, its arguments and what it returns', () => {
    const doc = hover("di|al('#f', 'frequency')");
    expect(doc?.signature).toBe('dial(target, param, options?)\ndial(name, range)');
    expect(doc?.kind).toBe('function');
    expect(doc?.description).toBe('Shows a dial for a parameter.');
    expect(doc?.rows?.map((row) => row.name)).toEqual([
      'target',
      'param',
      'options',
      'name',
      'range',
    ]);
    expect(doc?.rows?.[1]).toEqual({
      name: 'param',
      detail: 'parameter of target',
      description: 'Which parameter.',
    });
    expect(doc?.note).toBe('Returns the dial. It has .value, .set(value), .param.');
  });

  it('shows the way of calling in use and the argument being typed', () => {
    expect(signature('dial(|')).toMatchObject({
      signature: 'dial(target, param, options?)',
      active: 'target',
      description: 'target: Which nodes.',
      kind: 'function · 1 of 2',
    });
    expect(signature("dial('#f', |")?.active).toBe('param');
    expect(signature("dial('#f', 'q', { mode: '|' })")?.active).toBe('options');
    expect(signature("dial('density', { min: 0| })")).toMatchObject({
      active: 'range',
      kind: 'function · 2 of 2',
      description: 'A dial with a value of its own.',
    });
    expect(signature("panel('#kick', ['speed', '|'])")?.active).toBe('names');
    expect(signature('grid(|')?.kind).toBe('function');
    // Past the last argument nothing is marked.
    expect(signature("grid('a', 'b', 'c', 1, |")?.active).toBeUndefined();
  });

  it('describes option keys, parameter names and described names on hover', () => {
    expect(hover("dial('#f', 'frequency', { mo|de: 'db' })")).toMatchObject({
      signature: "mode: 'midi' | 'db' · default 'midi'",
      kind: 'option of dial',
      description: 'How it reads.',
    });
    expect(hover("dial('lowpass', 'frequ|ency')")?.kind).toBe('parameter of lowpass');
    expect(hover("panel('lowpass', ['frequ|ency'])")?.kind).toBe('parameter of lowpass');
    expect(hover("grid('int|ro')")?.description).toBe('Plays once at the start.');
    expect(hover("grid('beat', 've|rb')")?.description).toBe('The shared reverb.');
    expect(hover("dial('#le|ad', 'detune')")).toMatchObject({
      signature: '#lead',
      kind: 'id of a saw',
      description: 'The lead voice.',
    });
    expect(hover("dial('low|pass', 'q')")?.kind).toBe('filter');
    expect(hover("dial('#pla|in', 'q')")).toBeNull();
    expect(hover("dial('dens|ity', { min: 0 })")).toBeNull();
  });
});

describe('what a host function returns', () => {
  it('completes its members after a direct call and after a const holding it', () => {
    expect(labels("dial('#f', 'frequency').|")).toEqual(['value', 'set', 'param']);
    expect(labels("const cutoff = dial('#f', 'frequency');\ncutoff.|")).toEqual([
      'value',
      'set',
      'param',
    ]);
    expect(labels("const density = dial('density', { min: 0 });\ndensity.se|")).toContain('set');
    expect(infoOf("dial('#f', 'q').|", 'set')).toContain('Moves the dial.');
    const { result } = resultAt("dial('#f', 'q').|", catalog);
    expect(result?.options.find((o) => o.label === 'set')?.detail).toBe('(value)');
    // A function that returns nothing the host described.
    expect(labelsAt("panel('#f').|", catalog)).toBeNull();
  });

  it('follows a member or a function that gives one of the library’s own objects', () => {
    expect(labels("dial('#f', 'q').param.|")).toEqual(labels("__('lowpass').param('q').|"));
    expect(labels("grid('beat').|")).toEqual(labels("__.transport.get('beat').|"));
  });

  it('documents its members on hover and inside their brackets', () => {
    const code = "const cutoff = dial('#f', 'frequency');\n";
    expect(hover(`${code}cutoff.val|ue`)).toMatchObject({
      signature: 'value',
      kind: 'dial property',
      description: 'Where the dial is now.',
    });
    expect(hover(`${code}cutoff.se|t(2)`)?.kind).toBe('dial method');
    expect(signature(`${code}cutoff.set(|)`)).toMatchObject({
      signature: 'set(value)',
      active: 'value',
    });
    expect(hover(`${code}cutoff.nothi|ng`)).toBeNull();
  });
});

describe('names the host describes', () => {
  it('shows what a bus, a sequence and an id are for, in completion', () => {
    expect(infoOf("__().saw().to('|')", 'verb')).toContain('The shared reverb.');
    expect(infoOf("__().saw().to('|')", 'fx')).toBeNull();
    expect(infoOf("__.bus('|')", 'verb')).toContain('The shared reverb.');
    expect(infoOf("__.transport.get('|')", 'intro')).toContain('Plays once at the start.');
    expect(infoOf("__('|')", '#lead')).toContain('The lead voice.');
    expect(infoOf("__('|')", '#plain')).toBeNull();
    const { result } = resultAt("__('|')", catalog);
    const detail = (label: string) => result?.options.find((o) => o.label === label)?.detail;
    expect(detail('#lead')).toBe('saw');
    expect(detail('#plain')).toBe('id');
    expect(detail('#odd')).toBe('id');
  });

  it('shows them on hover wherever the library names one', () => {
    expect(hover("__().saw().to('ve|rb')")?.description).toBe('The shared reverb.');
    expect(hover("__.transport.get('int|ro')")?.kind).toBe('sequence');
    expect(hover("__('#le|ad')")?.kind).toBe('id of a saw');
    expect(hover("__().saw().to('f|x')")).toBeNull();
  });

  it('uses the type the host gives an id wherever a selector is read', () => {
    const setters = labels("__('#lead').|");
    expect(setters).toContain('detune');
    expect(setters).not.toContain('q');
    expect(labels("__('#lead').ramp('|')")).toEqual(labels("__('saw').ramp('|')"));
    // The script's own id of the same name is the nearer one.
    expect(labels("__().lowpass({ id: 'lead' });\n__('#lead').param('|')")).toEqual([
      'frequency',
      'q',
    ]);
  });

  it('keeps catalogs written before any of this as they were', () => {
    const old = resolveCatalog({
      types: base.types ?? [],
      ids: ['a', 'b'],
      buses: ['fx'],
      sequences: ['intro'],
      globals: [{ name: 'dial', signature: 'dial(target, param)', description: 'A dial.' }],
    });
    expect(old.ids).toEqual(['a', 'b']);
    expect(old.buses).toEqual(['fx']);
    expect(old.sequences).toEqual(['intro']);
    expect(old.functions.size).toBe(0);
    expect(labelsAt("__('|')", old)?.slice(0, 2)).toEqual(['#a', '#b']);
    expect(labelsAt("__().saw().to('|')", old)).toEqual(['main', 'fx']);
    expect(labelsAt("dial('|')", old)).toBeNull();
    const { state, pos } = stateAt('dial(|');
    expect(signatureAt(state, pos, old)?.doc.signature).toBe('dial(target, param)');
    expect(hover('di|al()', old)?.kind).toBe('global');
    expect(resolveCatalog({}).functions.size).toBe(0);
  });

  it('is plain data that survives a structured clone', () => {
    const cloned = resolveCatalog(structuredClone({ ...HOST, types: base.types ?? [] }));
    expect(labelsAt("dial('lowpass', '|')", cloned)).toEqual(['frequency', 'q']);
    expect(labelsAt("dial('#f', 'q').|", cloned)).toEqual(['value', 'set', 'param']);
  });

  it('leaves out what is not well formed instead of failing', () => {
    const broken = resolveCatalog({
      ...base,
      functions: [
        { name: 'none', description: 'No signatures.', signatures: [] },
        { name: 'bad' } as unknown as FunctionInfo,
        null as unknown as FunctionInfo,
        {
          name: 'loose',
          description: 'Arguments with parts missing.',
          signatures: [
            {
              args: [
                { name: 'a', kind: 'param', of: 'nobody' },
                { name: 'b', kind: 'list' },
                { name: 'c', kind: 'options' },
                { name: 'd', kind: 'mystery' as 'value' },
              ],
            },
          ],
        },
      ],
      ids: [null as unknown as string, { name: 'ok' }],
      buses: [{} as unknown as string],
    });
    expect([...broken.functions.keys()]).toEqual(['loose']);
    expect(broken.ids).toEqual(['ok']);
    expect(broken.buses).toEqual([]);
    expect(labelsAt("loose('|')", broken)).toContain('frequency');
    expect(labelsAt("loose('a', ['|'])", broken)).toBeNull();
    expect(labelsAt("loose('a', [], { | })", broken)).toBeNull();
    expect(labelsAt("loose('a', [], {}, '|')", broken)).toBeNull();
    const { state, pos } = stateAt("loo|se('a')");
    expect(hoverAt(state, pos, broken)?.doc.signature).toBe('loose(a, b, c, d)');
  });

  it('never reads catalog text as HTML', () => {
    const markup = '<img src=x onerror="window.__hacked = true"><b>bold</b>';
    const hostile = resolveCatalog({
      ...base,
      functions: [
        {
          name: 'evil',
          description: markup,
          signatures: [
            {
              args: [
                {
                  name: 'options',
                  description: markup,
                  kind: 'options',
                  options: [{ name: 'key', description: markup, type: markup, values: [markup] }],
                },
              ],
              returns: {
                name: markup,
                description: markup,
                members: [{ name: 'member', signature: markup, description: markup }],
              },
            },
          ],
        },
      ],
      ids: [{ name: 'node', type: markup, description: markup }],
      buses: [{ name: 'bus', description: markup }],
      sequences: [{ name: 'seq', description: markup }],
    });
    const shown: Node[] = [];
    const collect = (code: string): void => {
      const { state, pos } = stateAt(code);
      const hovered = hoverAt(state, pos, hostile);
      if (hovered) shown.push(renderDoc(hovered.doc));
      const help = signatureAt(state, pos, hostile);
      if (help) shown.push(renderDoc(help.doc, { brief: true }));
      for (const option of resultAt(code, hostile, true).result?.options ?? []) {
        if (typeof option.info === 'function') shown.push((option.info as () => Node)());
      }
    };
    for (const code of [
      'ev|il()',
      'evil(|)',
      'evil({ | })',
      'evil({ ke|y: 1 })',
      "evil({ key: '|' })",
      'evil().|',
      'evil().mem|ber',
      "__('#no|de')",
      "__('|')",
      "__().saw().to('|')",
      "__().saw().to('bu|s')",
      "__.transport.get('|')",
      'ev|',
    ]) {
      collect(code);
    }
    expect(shown.length).toBeGreaterThan(8);
    const holder = document.createElement('div');
    document.body.append(holder);
    holder.append(...shown);
    expect(holder.textContent).toContain('<b>bold</b>');
    expect(holder.querySelector('img, b')).toBeNull();
    expect((window as unknown as { __hacked?: boolean }).__hacked).toBeUndefined();
    holder.remove();
  });
});

describe('catalogs made from what is at hand', () => {
  it('reads ids with their types, classes, buses and sequences from a scope', async () => {
    const engine = await offlineEngine(0.01);
    const scope = engine.scope('track');
    scope.bus('drums');
    scope.$().saw({ id: 'bass', class: 'voice' }).lowpass({ id: 'tone' }).to('drums');
    scope.transport.sequence('beat', { steps: [1, 0] }, () => {});
    const names = catalogFromScope(scope);
    expect(names.ids).toEqual([
      { name: 'bass', type: 'saw' },
      { name: 'tone', type: 'lowpass' },
    ]);
    expect(names.classes).toEqual(['voice']);
    expect(names.buses).toEqual(['drums']);
    expect(names.sequences).toEqual(['beat']);
    expect(catalogFromSnapshot(scope.snapshot()).ids).toEqual(names.ids);

    // An editor on another script knows what #tone is.
    const other = resolveCatalog(catalogFromEngine(engine, { ...names, functions: FUNCTIONS }));
    expect(labelsAt("dial('#tone', '|')", other)).toEqual(['frequency', 'q']);
    expect(structuredClone(names)).toEqual(names);
    engine.dispose();
  });

  it('reads the same from the state a sandbox is sent, when it has a snapshot', async () => {
    const engine = await offlineEngine(0.01);
    const scope = engine.scope('track');
    scope.bus('drums');
    scope.$().saw({ id: 'bass' }).to('drums');
    const state = structuredClone({
      types: engine.registry.list(),
      buffers: [],
      snapshot: scope.snapshot(),
    });
    const made = catalogFromRemoteState(state);
    expect(made.ids).toEqual([{ name: 'bass', type: 'saw' }]);
    expect(made.buses).toEqual(['drums']);
    // What the host passes itself wins, and a state with no snapshot lists none.
    expect(catalogFromRemoteState(state, { ids: ['mine'] }).ids).toEqual(['mine']);
    expect(catalogFromRemoteState({ types: state.types }).ids).toBeUndefined();
    expect(catalogFromEngine(await testEngine()).ids).toBeUndefined();
    engine.dispose();
  });
});

// --- The editor itself --------------------------------------------------------------------------------

const made: Editor[] = [];
const hosts: HTMLElement[] = [];

function mount(options: Partial<Parameters<typeof createEditor>[0]> = {}): Editor {
  const parent = document.createElement('div');
  parent.style.cssText = 'width: 800px; height: 120px;';
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

const frame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => done()));

describe('diagnostics from the host', () => {
  const marked = (editor: Editor, severity = ''): string[] =>
    [
      ...editor.element.querySelectorAll(
        severity ? `.cu-diagnostic-${severity}` : '.cu-diagnostic',
      ),
    ].map((element) => element.textContent ?? '');

  it('underlines each problem by position or by line and column, and clears them', () => {
    const editor = mount({ doc: "dial('#nobody', 'q');\n  grid('missing');\nlast" });
    editor.setDiagnostics([
      { from: 5, to: 14, severity: 'warning', message: 'No node has this id.' },
      { line: 2, severity: 'error', message: 'No such sequence.', source: 'host' },
      { line: 3, column: 1, severity: 'info', message: 'A word.' },
    ]);
    expect(marked(editor, 'warning')).toEqual(["'#nobody'"]);
    expect(marked(editor, 'error')).toEqual(["grid('missing');"]);
    expect(marked(editor, 'info')).toEqual(['last']);
    expect(editor.diagnostics).toEqual([
      { from: 5, to: 14, line: 1, column: 6, severity: 'warning', message: 'No node has this id.' },
      {
        from: 24,
        to: 40,
        line: 2,
        column: 3,
        severity: 'error',
        message: 'No such sequence.',
        source: 'host',
      },
      { from: 41, to: 45, line: 3, column: 1, severity: 'info', message: 'A word.' },
    ]);
    // A new list replaces the old one.
    editor.setDiagnostics([{ line: 3, severity: 'error', message: 'Only this.' }]);
    expect(marked(editor)).toEqual(['last']);
    editor.clearDiagnostics();
    expect(marked(editor)).toEqual([]);
    expect(editor.diagnostics).toEqual([]);
  });

  it('takes an end line and column, and leaves out a place the text has not got', () => {
    const editor = mount({ doc: 'one two\nthree' });
    editor.setDiagnostics([
      { line: 1, column: 5, endLine: 2, endColumn: 4, severity: 'error', message: 'Across.' },
      { line: 9, severity: 'error', message: 'Nowhere.' },
      { severity: 'error', message: 'No place at all.' },
      { from: 999, severity: 'warning', message: 'Past the end.' },
    ]);
    expect(editor.diagnostics.map(({ from, to, message }) => [from, to, message])).toEqual([
      [4, 11, 'Across.'],
      [13, 13, 'Past the end.'],
    ]);
  });

  it('marks the line of a problem that has no text to underline', () => {
    const editor = mount({ doc: 'a\n\nb' });
    editor.setDiagnostics([{ line: 2, severity: 'warning', message: 'An empty line.' }]);
    expect(marked(editor)).toEqual([]);
    expect(editor.element.querySelectorAll('.cu-diagnostic-line-warning')).toHaveLength(1);
    expect(diagnosticsAt(editor.view.state, 2).map((d) => d.message)).toEqual(['An empty line.']);
  });

  it('keeps each problem on its text as the user edits, and drops one whose text is deleted', () => {
    const editor = mount({ doc: "dial('#nobody');\ngrid('missing');" });
    editor.setDiagnostics([
      { from: 5, to: 14, severity: 'warning', message: 'First.' },
      { line: 2, column: 6, endColumn: 15, severity: 'error', message: 'Second.' },
    ]);
    editor.view.dispatch({ changes: { from: 0, insert: '// a comment\n' } });
    expect(marked(editor)).toEqual(["'#nobody'", "'missing'"]);
    expect(editor.diagnostics.map((d) => d.line)).toEqual([2, 3]);
    // Typing inside one widens it; typing at its edges does not.
    const first = editor.diagnostics[0]!;
    editor.view.dispatch({ changes: { from: first.from + 2, insert: 'xx' } });
    editor.view.dispatch({ changes: { from: editor.diagnostics[0]!.to, insert: ' ' } });
    editor.view.dispatch({ changes: { from: editor.diagnostics[0]!.from, insert: ' ' } });
    expect(marked(editor, 'warning')).toEqual(["'#xxnobody'"]);
    // Deleting all of one removes it; the other stays.
    const gone = editor.diagnostics[0]!;
    editor.view.dispatch({ changes: { from: gone.from - 1, to: gone.to + 1 } });
    expect(editor.diagnostics.map((d) => d.message)).toEqual(['Second.']);
    expect(marked(editor)).toEqual(["'missing'"]);
    // The host's own change of text moves them as well.
    editor.setValue(`\n${editor.value}`);
    expect(marked(editor)).toEqual(["'missing'"]);
    editor.setValue('new document', { history: 'reset' });
    expect(editor.diagnostics).toEqual([]);
  });

  it('says what is wrong at a position, with every problem there', () => {
    const editor = mount({ doc: "dial('#nobody', 'q')" });
    editor.setDiagnostics([
      { from: 5, to: 14, severity: 'warning', message: 'No node has this id.', source: 'host' },
      { from: 0, to: 20, severity: 'info', message: 'The whole call.' },
    ]);
    const at = (pos: number): string[] =>
      diagnosticsAt(editor.view.state, pos).map((found) => found.message);
    expect(at(8)).toEqual(['The whole call.', 'No node has this id.']);
    expect(at(17)).toEqual(['The whole call.']);
    editor.clearDiagnostics();
    expect(at(8)).toEqual([]);
  });

  it('shows the message on hover, as text', async () => {
    const markup = '<img src=x onerror="window.__hacked = true"> is not a node';
    const editor = mount({ doc: "dial('#nobody', 'q')" });
    editor.setDiagnostics([
      { from: 5, to: 14, severity: 'warning', message: markup, source: '<i>' },
    ]);
    const target = editor.element.querySelector('.cu-diagnostic')!;
    const box = target.getBoundingClientRect();
    const where = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
    editor.view.contentDOM.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...where }));
    await expect
      .poll(() => editor.element.querySelector('.cu-diagnostic-tooltip')?.textContent, {
        timeout: 3000,
      })
      .toContain('is not a node');
    const tooltip = editor.element.querySelector('.cu-diagnostic-tooltip')!;
    expect(tooltip.querySelector('.cu-diagnostic-text')?.textContent).toBe(markup);
    expect(tooltip.querySelector('.cu-diagnostic-source')?.textContent).toBe('<i>');
    expect(tooltip.querySelector('.cu-diagnostic-severity')?.textContent).toBe('warning');
    expect(tooltip.querySelector('img, i')).toBeNull();
    expect((window as unknown as { __hacked?: boolean }).__hacked).toBeUndefined();
  });

  it('goes from one problem to the next with F8, showing each message', async () => {
    const editor = mount({ doc: 'one\ntwo\nthree' });
    editor.setDiagnostics([
      { line: 1, severity: 'info', message: 'About one.' },
      { line: 3, severity: 'error', message: 'About three.' },
    ]);
    editor.focus();
    const press = (key: string, shiftKey = false): void => {
      editor.view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
      );
    };
    const shown = (): string | null =>
      editor.element.querySelector('.cu-diagnostic-tooltip .cu-diagnostic-text')?.textContent ??
      null;
    press('F8');
    await frame();
    expect(editor.cursor.line).toBe(3);
    expect(shown()).toBe('About three.');
    expect(editor.element.querySelector('.cu-diagnostic-tooltip')?.getAttribute('role')).toBe(
      'status',
    );
    press('F8');
    await frame();
    expect(editor.cursor.line).toBe(1);
    expect(shown()).toBe('About one.');
    press('F8', true);
    await frame();
    expect(editor.cursor.line).toBe(3);
    press('Escape');
    await frame();
    expect(shown()).toBeNull();
    // Moving the cursor away hides it too.
    press('F8');
    await frame();
    expect(shown()).toBe('About one.');
    editor.view.dispatch({ selection: { anchor: 5 } });
    await frame();
    expect(shown()).toBeNull();
  });

  it('colours the line number of a line with a problem, by the worst on it', () => {
    const editor = mount({ doc: 'one\ntwo\nthree', lineNumbers: true });
    editor.setDiagnostics([
      { line: 2, severity: 'info', message: 'Minor.' },
      { line: 2, column: 1, severity: 'error', message: 'Major.' },
      { line: 3, severity: 'warning', message: 'Middling.' },
    ]);
    const numbers = (severity: string): string[] =>
      [...editor.element.querySelectorAll(`.cm-lineNumbers .cu-diagnostic-gutter-${severity}`)].map(
        (element) => element.textContent ?? '',
      );
    expect(numbers('error')).toEqual(['2']);
    expect(numbers('info')).toEqual([]);
    expect(numbers('warning')).toEqual(['3']);
    editor.clearDiagnostics();
    expect(editor.element.querySelector('.cu-diagnostic-gutter')).toBeNull();
  });

  it('takes its colours from custom properties the host can set', () => {
    const editor = mount({ doc: 'one', theme: 'light' });
    editor.setDiagnostics([{ line: 1, severity: 'warning', message: 'Hm.' }]);
    const colour = (): string =>
      getComputedStyle(editor.element.querySelector('.cu-diagnostic')!).textDecorationColor;
    expect(colour()).toBe('rgb(138, 90, 0)');
    editor.element.style.setProperty('--cu-warning-text', 'rgb(1, 2, 3)');
    expect(colour()).toBe('rgb(1, 2, 3)');
    expect(
      getComputedStyle(editor.element.querySelector('.cu-diagnostic')!).textDecorationLine,
    ).toContain('underline');
  });

  it('keeps each editor’s problems its own, also with a shared catalog', () => {
    const store = createCatalogStore(base);
    const first = mount({ doc: 'first', catalog: store });
    const second = mount({ doc: 'second', catalog: store });
    first.setDiagnostics([{ line: 1, severity: 'error', message: 'In the first.' }]);
    second.setDiagnostics([{ line: 1, severity: 'info', message: 'In the second.' }]);
    expect(marked(first, 'error')).toEqual(['first']);
    expect(marked(first, 'info')).toEqual([]);
    expect(marked(second, 'info')).toEqual(['second']);
    first.clearDiagnostics();
    store.update({ buses: ['x'] });
    expect(marked(first)).toEqual([]);
    expect(second.diagnostics.map((d) => d.message)).toEqual(['In the second.']);
    // Beside an error shown the older way.
    second.showError('Broken.', { line: 1 });
    expect(marked(second, 'info')).toEqual(['second']);
    second.clearError();
    expect(marked(second, 'info')).toEqual(['second']);
  });
});

describe('where the cursor is, and going to a place', () => {
  it('reports the cursor and the selection', () => {
    const editor = mount({ doc: 'one\ntwo three\nfour' });
    expect(editor.cursor).toEqual({ pos: 0, line: 1, column: 1, from: 0, to: 0, empty: true });
    editor.view.dispatch({ selection: { anchor: 11, head: 8 } });
    expect(editor.cursor).toEqual({ pos: 8, line: 2, column: 5, from: 8, to: 11, empty: false });
  });

  it('calls onCursor when the user moves or types, and not for the host’s own changes', () => {
    const seen: CursorInfo[] = [];
    const editor = mount({ doc: 'one\ntwo', onCursor: (cursor) => seen.push(cursor) });
    editor.view.dispatch({ selection: { anchor: 5 }, userEvent: 'select.pointer' });
    expect(seen).toEqual([{ pos: 5, line: 2, column: 2, from: 5, to: 5, empty: true }]);
    editor.insert('x');
    expect(seen.at(-1)).toMatchObject({ pos: 6, line: 2, column: 3 });
    // The same place again is not news.
    editor.view.dispatch({ selection: { anchor: 6 } });
    expect(seen).toHaveLength(2);
    editor.setValue('zero\none\ntxwo');
    editor.reveal({ line: 1 });
    editor.reveal({ line: 2 }, { flash: true });
    expect(seen).toHaveLength(2);
    expect(editor.cursor.line).toBe(2);
  });

  it('reveals a line: scrolls to it and puts the cursor there', async () => {
    const lines = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`);
    const editor = mount({ doc: lines.join('\n') });
    expect(editor.reveal({ line: 150 })).toBe(true);
    await frame();
    await frame();
    expect(editor.cursor).toMatchObject({ line: 150, column: 1, empty: true });
    expect(editor.view.scrollDOM.scrollTop).toBeGreaterThan(1000);
    const visible = [...editor.element.querySelectorAll('.cm-line')].map((l) => l.textContent);
    expect(visible).toContain('line 150');
    expect(editor.view.hasFocus).toBe(false);

    expect(editor.reveal({ line: 3, column: 6 }, { focus: true })).toBe(true);
    expect(editor.cursor).toMatchObject({ line: 3, column: 6 });
    expect(editor.view.hasFocus).toBe(true);
    expect(editor.reveal({ pos: editor.value.indexOf('line 20') })).toBe(true);
    expect(editor.cursor.line).toBe(20);
  });

  it('selects the line or leaves the selection alone, as asked', async () => {
    const lines = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`);
    const editor = mount({ doc: lines.join('\n') });
    editor.reveal({ line: 2 }, { select: 'line' });
    expect(editor.view.state.sliceDoc(editor.cursor.from, editor.cursor.to)).toBe('line 2');
    editor.reveal({ line: 180 }, { select: 'none' });
    await frame();
    await frame();
    expect(editor.view.state.sliceDoc(editor.cursor.from, editor.cursor.to)).toBe('line 2');
    expect(editor.view.scrollDOM.scrollTop).toBeGreaterThan(1000);
  });

  it('marks the line for a moment when asked', async () => {
    const editor = mount({ doc: 'one\ntwo\nthree' });
    const flashed = (): string | null =>
      editor.element.querySelector('.cu-flash-line')?.textContent ?? null;
    editor.reveal({ line: 2 }, { flash: true });
    expect(flashed()).toBe('two');
    // It stays on its line while it lasts, and goes by itself.
    editor.view.dispatch({ changes: { from: 0, insert: 'zero\n' } });
    expect(flashed()).toBe('two');
    await expect.poll(flashed, { timeout: 3000 }).toBeNull();
    editor.reveal({ line: 1 });
    expect(flashed()).toBeNull();
  });

  it('refuses a place the text has not got', () => {
    const editor = mount({ doc: 'one\ntwo' });
    editor.view.dispatch({ selection: { anchor: 2 } });
    expect(editor.reveal({ line: 9 })).toBe(false);
    expect(editor.reveal({ line: 0 })).toBe(false);
    expect(editor.reveal({})).toBe(false);
    expect(editor.cursor.pos).toBe(2);
    // A flash pending when the editor is destroyed does nothing afterwards.
    editor.reveal({ line: 1 }, { flash: true });
    expect(() => editor.destroy()).not.toThrow();
  });
});
