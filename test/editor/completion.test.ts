import { beforeAll, describe, expect, it } from 'vitest';
import { resolveCatalog } from '../../src/editor';
import type { ResolvedCatalog } from '../../src/editor';
import { API } from '../../src/editor/api-docs';
import { labelsAt, resultAt, testCatalog, testEngine } from './setup';

let catalog: ResolvedCatalog;
beforeAll(async () => {
  catalog = await testCatalog();
});

const labels = (code: string, explicit = false): string[] =>
  labelsAt(code, catalog, explicit) ?? [];

describe('completion after a dot', () => {
  it('offers node types and chain methods on a chain', () => {
    const found = labels('__().|');
    for (const name of ['saw', 'lowpass', 'sampler', 'polysynth', 'tapedelay']) {
      expect(found, name).toContain(name);
    }
    for (const name of ['to', 'connect', 'modulate', 'split']) expect(found, name).toContain(name);
    // A chain has no set() or trigger(): those belong to selections.
    expect(found).not.toContain('set');
    expect(found).not.toContain('trigger');
  });

  it('offers every registered type, each with its description and category', async () => {
    const engine = await testEngine();
    const { result } = resultAt('__().saw().|', catalog);
    for (const info of engine.registry.list()) {
      const option = result?.options.find((candidate) => candidate.label === info.type);
      expect(option, info.type).toBeDefined();
      expect(option?.detail, info.type).toContain(info.category);
      const shown = (option?.info as () => Node)();
      expect(shown.textContent, info.type).toContain(info.description);
    }
  });

  it('keeps going along a chain, across lines and after a half-typed name', () => {
    expect(labels("__().saw({ id: 'bass' })\n  .lowpass(500)\n  .|")).toContain('gain');
    expect(labels('__().saw().low|')).toContain('lowpass');
    expect(labels("__.bus('drums').chain().|")).toContain('recorder');
    expect(labels("__('#x').chain().|")).toContain('lowpass');
  });

  it('offers selection methods and parameter setters on a selection', () => {
    const found = labels("__().saw({ id: 'bass' });\n__('#bass').|");
    for (const name of ['set', 'trigger', 'release', 'param', 'call', 'bypass', 'ramp', 'chain']) {
      expect(found, name).toContain(name);
    }
    // #bass is a saw, so its setters are a saw's parameters.
    expect(found).toContain('frequency');
    expect(found).toContain('detune');
    expect(found).not.toContain('q');
    expect(found).not.toContain('lowpass');
  });

  it('offers the setters of every type when the selection cannot be worked out', () => {
    const found = labels("__('[role=send]').|");
    expect(found).toContain('frequency');
    expect(found).toContain('q');
    expect(found).toContain('feedback');
    // `release` is a method, so the parameter of that name has no setter.
    expect(found.filter((name) => name === 'release')).toHaveLength(1);
  });

  it('follows selections through methods that give them back', () => {
    expect(labels("__('lowpass').set({ q: 2 }).|")).toContain('trigger');
    expect(labels("__('lowpass').frequency(200).|")).toContain('q');
    expect(labels("__('polysynth').select('lowpass').|")).toContain('frequency');
    expect(labels("__('lowpass').param('frequency').|")).toEqual(API.param.map((m) => m.name));
  });

  it('offers the members of __, the transport, a bus and a sequence', () => {
    expect(labels('__.|')).toEqual(['transport', 'bus', 'scope']);
    const transport = labels('__.transport.|');
    for (const name of ['bpm', 'swing', 'sequence', 'steps', 'every', 'at', 'seconds', 'clear']) {
      expect(transport, name).toContain(name);
    }
    expect(labels("__.bus('drums').|")).toEqual(['name', 'gain', 'to', 'chain']);
    expect(labels("__.transport.sequence('a', { steps: 4 }, () => {}).|")).toContain('setStep');
    expect(labels("__.transport.get('a').|")).toContain('restart');
    expect(labels('__.transport.position.|')).toContain('beatInBar');
  });

  it('knows a variable by what it was assigned, and a callback argument by its callback', () => {
    expect(labels("const bass = __('saw');\nbass.|")).toContain('detune');
    expect(labels('const t = __.transport;\nt.|')).toContain('bpm');
    expect(labels("__.transport.sequence('a', { steps: 4 }, (ev) => { ev.| })")).toEqual(
      API.event.map((member) => member.name),
    );
    expect(labels('__().saw().split((branch) => branch.|)')).toContain('lowpass');
  });

  it('offers nothing after a dot on something it does not know', () => {
    expect(labelsAt('Math.|', catalog)).toBeNull();
    expect(labelsAt('foo.bar.|', catalog)).toBeNull();
    expect(labelsAt('const n = 1.|', catalog)).toBeNull();
  });

  it('treats __ inside a macro definition the same way', () => {
    expect(labels("define({ type: 'blip', build(__) { __().| } })")).toContain('sine');
  });
});

describe('completion inside an options object', () => {
  it('offers a type’s parameters, its options and the options every node has', () => {
    const { result } = resultAt('__().lowpass({ | })', catalog);
    const found = result?.options.map((option) => option.label);
    expect(found).toEqual(['frequency', 'q', 'id', 'class', 'tags', 'bypass']);
    const frequency = result?.options.find((option) => option.label === 'frequency');
    // Default, unit and range.
    expect(frequency?.detail).toBe('20000 hz · 20 to 20000');
    expect((frequency?.info as () => Node)().textContent).toContain('lowpass');
    expect(labels('__().sampler({ | })')).toContain('buffer');
    expect(labels('__().saw({ | })')).toContain('gate');
  });

  it('leaves out keys the object already has, and completes a half-typed key', () => {
    expect(labels('__().lowpass({ frequency: 200, | })')).toEqual([
      'q',
      'id',
      'class',
      'tags',
      'bypass',
    ]);
    expect(labels("__().lowpass({ id: 'f', fre| })")).toContain('frequency');
    expect(labels('__().lowpass({ fre|')).toContain('frequency');
  });

  it('offers trigger options and parameters inside trigger()', () => {
    const found = labels("__().sampler({ id: 'kick' });\n__('#kick').trigger({ | })");
    expect(found).toContain('slice');
    expect(found).toContain('duration');
    expect(found).toContain('at');
    expect(found).toContain('speed');
    // A sampler has no pitch to trigger with; that is the synths'.
    expect(found).not.toContain('pitch');
    expect(labels("__('polysynth').trigger({ | })")).toContain('pitch');
  });

  it('offers the parameters of the selected types inside set()', () => {
    const code = "__().saw({ id: 'bass' }).lowpass({ class: 'wet' });\n";
    expect(labels(`${code}__('#bass').set({ | })`)).toEqual(['frequency', 'detune']);
    expect(labels(`${code}__('.wet').set({ | })`)).toEqual(['frequency', 'q']);
    expect(labels(`${code}__('lowpass, saw').set({ | })`).sort()).toEqual([
      'detune',
      'frequency',
      'q',
    ]);
    // Nothing says what `.loud` is, so every parameter is offered.
    const all = labels(`${code}__('.loud').set({ | })`);
    expect(all).toContain('feedback');
    expect(all).toContain('attack');
    expect(labels(`${code}__('#bass').set({ frequency: 1 }, { | })`)).toEqual(['at']);
  });

  it('offers sequence, ramp and release options', () => {
    const sequence = labels("__.transport.sequence('a', { | }, () => {})");
    expect(sequence).toEqual([
      'steps',
      'step',
      'span',
      'swing',
      'offset',
      'probability',
      'order',
      'rests',
    ]);
    expect(labels('__.transport.sequence({ | }, () => {})')).toContain('steps');
    expect(labels("__('saw').ramp('frequency', 200, { | })")).toEqual([
      'duration',
      'curve',
      'from',
      'at',
    ]);
    expect(labels("__('adsr').release({ | })")).toEqual(['at', 'pitch']);
    expect(labels("__.transport.every('1 bar', () => {}, { | })")).toEqual(['offset', 'order']);
  });

  it('offers values: choices, booleans and buffers', () => {
    expect(labels('__().sampler({ buffer: | })')).toEqual(["'kick'", "'hat'", "'break'"]);
    expect(labels('__().sampler({ loop: | })')).toEqual(['true', 'false']);
    expect(labels('__().sampler({ loop: t| })')).toContain('true');
    expect(labels('__().saw({ gate: | })')).toEqual(["'open'", "'closed'"]);
    expect(labels('__().lowpass({ frequency: | })', true)).toContain('pitchToFreq');
  });

  it('offers nothing inside an object it knows nothing about', () => {
    expect(labelsAt('const options = { | }', catalog)).toBeNull();
    expect(labelsAt('foo({ | })', catalog)).toBeNull();
    expect(labelsAt('__().lowpass({ tags: { | } })', catalog)).toBeNull();
  });
});

describe('completion inside strings', () => {
  const graph = `__.bus('drums');
__().sampler({ id: 'kick', class: 'drum loud' }).to('drums');
__().saw({ id: 'bass' }).lowpass({ id: 'filter', class: 'wet' }).to('main');
__.transport.sequence('beat', { steps: 4 }, () => {});
`;

  it('offers ids, classes and types in a selector', () => {
    const { result, pos } = resultAt(`${graph}__('|')`, catalog);
    const found = result?.options.map((option) => option.label) ?? [];
    expect(found.slice(0, 6)).toEqual(['#kick', '#bass', '#filter', '.drum', '.loud', '.wet']);
    expect(found).toContain('sampler');
    expect(found).toContain('*');
    expect(result?.from).toBe(pos);
    expect(result?.options.find((option) => option.label === '#filter')?.detail).toBe('lowpass');
  });

  it('completes the last part of a selector, whatever comes before it', () => {
    const { result, pos } = resultAt(`${graph}__('polysynth #fi|')`, catalog);
    expect(result?.from).toBe(pos - 3);
    expect(result?.options.map((option) => option.label)).toContain('#filter');
    expect(resultAt(`${graph}__('sampler, .lo|')`, catalog).result?.from).toBe(
      resultAt(`${graph}__('sampler, .lo|')`, catalog).pos - 3,
    );
    expect(labels(`${graph}__('#ba|`)).toContain('#bass');
  });

  it('offers selectors in connect(), select() and modulate()', () => {
    expect(labels(`${graph}__().lfo().connect('|')`)).toContain('#filter');
    expect(labels(`${graph}__('polysynth').select('|')`)).toContain('lowpass');
    expect(labels(`${graph}__().sine(2).modulate('|')`)).toContain('#filter');
  });

  it('offers the target’s parameters as the second argument of modulate()', () => {
    expect(labels(`${graph}__().sine(2).modulate('#filter', '|')`)).toEqual(['frequency', 'q']);
    expect(labels(`${graph}__('#bass').param('|')`)).toEqual(['frequency', 'detune']);
    expect(labels(`${graph}__('#filter').ramp('|', 200, { duration: 1 })`)).toEqual([
      'frequency',
      'q',
    ]);
  });

  it('offers bus names: main, the document’s and the catalog’s', () => {
    expect(labels(`${graph}__().sine().to('|')`)).toEqual(['main', 'drums']);
    expect(labels(`${graph}__.bus('|')`)).toEqual(['main', 'drums']);
    const withHost = resolveCatalog({ ...catalog.source, buses: ['reverb-send', 'drums'] });
    expect(labelsAt(`${graph}__().sine().to('|')`, withHost)).toEqual([
      'main',
      'drums',
      'reverb-send',
    ]);
    // Inside a macro, its own output.
    expect(labels("define({ type: 'blip', build(__) { __().sine().to('|') } })")).toEqual([
      'main',
      'out',
    ]);
  });

  it('offers buffer names with their slice counts', () => {
    const { result } = resultAt("__().sampler({ buffer: '|' })", catalog);
    expect(result?.options.map((option) => option.label)).toEqual(['kick', 'hat', 'break']);
    expect(result?.options[2]?.detail).toBe('buffer · 4 slices');
    expect(labels("__().sampler({ id: 'k', buffer: 'ki|' })")).toContain('kick');
  });

  it('offers sequence names, durations and choices', () => {
    expect(labels(`${graph}__.transport.get('|')`)).toEqual(['beat']);
    expect(labels("__.transport.every('|', () => {})")).toContain('1 bar');
    expect(labels("__.transport.sequence('a', { steps: 4, step: '|' }, () => {})")).toContain(
      '1/8',
    );
    expect(labels("__().saw({ gate: '|' })")).toEqual(['open', 'closed']);
  });

  it('offers nothing in a string it knows nothing about, or in a comment', () => {
    expect(labelsAt("const s = '|'", catalog)).toBeNull();
    expect(labelsAt("console.log('|')", catalog)).toBeNull();
    expect(labelsAt('// __().|', catalog)).toBeNull();
    expect(labelsAt('/* __(). | */', catalog)).toBeNull();
    expect(labelsAt('`${1}|`', catalog)).toBeNull();
  });
});

describe('completion of names', () => {
  it('offers __ and the helpers once something is typed, with signature and description', () => {
    const { result } = resultAt('eu|', catalog);
    const found = result?.options.map((option) => option.label) ?? [];
    expect(found).toContain('euclid');
    expect(found).toContain('__');
    const euclid = result?.options.find((option) => option.label === 'euclid');
    expect(euclid?.detail).toBe('(hits, steps, rotate?)');
    expect((euclid?.info as () => Node)().textContent).toContain('spread as evenly as possible');
    // The Cracked names work too.
    expect(found).toContain('fill_array');
  });

  it('waits to be asked on an empty spot', () => {
    expect(labelsAt('|', catalog)).toBeNull();
    expect(labelsAt('|', catalog, true)).toContain('euclid');
    expect(labelsAt('const x = |', catalog, true)).toContain('pitchToFreq');
  });

  it('does not offer names where a name is being declared', () => {
    expect(labelsAt('const eu|', catalog)).toBeNull();
    expect(labelsAt('function f(eu|) {}', catalog)).toBeNull();
  });

  it('leaves out a helper the script has declared a variable over', () => {
    expect(labels('const scale = 2;\nsc|')).not.toContain('scale');
  });

  it('offers the host’s globals', () => {
    const withGlobals = resolveCatalog({
      ...catalog.source,
      globals: [
        { name: 'engine', description: 'The engine.' },
        { name: 'define', signature: 'define(definition)', description: 'Defines a node type.' },
      ],
    });
    const found = labelsAt('|', withGlobals, true) ?? [];
    expect(found).toContain('engine');
    expect(found).toContain('define');
  });
});

describe('types the script defines', () => {
  const code = `define({
  type: 'blip',
  description: 'A short beep.',
  params: { pitch: { default: 660, min: 50, max: 4000, description: 'How high.' }, on: { default: true } },
  build(__) { __().sine({ id: 'tone' }).to('out'); },
  trigger(__, options) {},
});
`;

  it('are offered on chains before the host knows them', () => {
    const { result } = resultAt(`${code}__().|`, catalog);
    const blip = result?.options.find((option) => option.label === 'blip');
    expect(blip).toBeDefined();
    expect((blip?.info as () => Node)().textContent).toContain('A short beep.');
  });

  it('have their parameters read from the definition', () => {
    const { result } = resultAt(`${code}__().blip({ | })`, catalog);
    expect(result?.options.map((option) => option.label)).toEqual([
      'pitch',
      'on',
      'id',
      'class',
      'tags',
      'bypass',
    ]);
    expect(result?.options[0]?.detail).toBe('660 · 50 to 4000');
    expect(labels(`${code}__().blip({ id: 'b' });\n__('#b').set({ | })`)).toEqual(['pitch', 'on']);
    expect(labels(`${code}__().blip({ on: | })`)).toEqual(['true', 'false']);
  });

  it('get definition fields inside define()', () => {
    expect(labels('define({ | })')).toContain('build');
    expect(labels("define({ type: 'x', | })")).not.toContain('type');
  });
});

describe('completion never throws', () => {
  it('on any prefix of a real script, at any position', () => {
    const script = `__.transport.bpm = 110;
__.bus('drums');
__().sampler({ id: 'kick', buffer: 'kick' }).to('drums');
__.transport.sequence('hat', { steps: euclid(5, 8), step: '1/8' }, (ev) => {
  if (ev.value) __('#hat').trigger({ speed: 1 + ev.index * 0.04 });
});
define({ type: 'blip', params: { pitch: { default: 660 } }, build(__) { __().sine().to('out'); } });
const s = \`a\${__('x').length}b\`; /* c */ // d
`;
    for (let length = 0; length <= script.length; length++) {
      const prefix = script.slice(0, length);
      expect(() => labelsAt(`${prefix}|`, catalog, true), prefix).not.toThrow();
    }
    // And in the middle of the whole thing.
    for (let pos = 0; pos <= script.length; pos += 3) {
      const code = `${script.slice(0, pos)}|${script.slice(pos)}`;
      expect(() => labelsAt(code, catalog, false)).not.toThrow();
    }
  });

  it('on odd input', () => {
    for (const code of [
      '.|',
      '{|',
      '({|',
      "'|",
      '__(|',
      '__()..|',
      ')|',
      '__().saw({ ...|',
      '[.|]',
      '\u{1F600}.|',
    ]) {
      expect(() => labelsAt(code, catalog, true), code).not.toThrow();
    }
  });
});

describe('the API table', () => {
  it('names only members that exist on the real objects', async () => {
    const engine = await testEngine();
    const __ = engine.scope('api-check').$ ?? engine.$;
    const chain = __().sine({ id: 'api-check-sine' });
    const selection = __('#api-check-sine');
    const node = selection.first()!;
    const sequence = __.transport.sequence('api-check', { steps: 4 }, () => {});
    const subjects: Record<string, object> = {
      dunder: __,
      transport: __.transport,
      chain,
      selection,
      node,
      bus: __.bus('api-check-bus'),
      sequence,
      param: selection.param('frequency'),
      position: __.transport.position,
    };
    for (const [kind, subject] of Object.entries(subjects)) {
      for (const member of API[kind as keyof typeof API]) {
        expect(member.name in subject, `${kind}.${member.name}`).toBe(true);
        const value = (subject as Record<string, unknown>)[member.name];
        expect(typeof value === 'function', `${kind}.${member.name} is a method`).toBe(
          member.signature !== undefined,
        );
      }
    }
    // And a chain really has no set(): the completion test above relies on it.
    expect('set' in chain).toBe(false);
    sequence.stop();
  });
});
