import { describe, expect, it } from 'vitest';
import {
  createEngine,
  defineMacro,
  defineNode,
  describeNodeType,
  describeNodeTypes,
} from '../../src';
import { catalogFromEngine, catalogFromNodes } from '../../src/editor';
import { builtinNodes } from '../../src/nodes';
import { SAMPLE_RATE, offlineEngine } from './setup';

const tremolo = defineMacro({
  type: 'tremolo',
  category: 'dynamics',
  description: 'Volume that wobbles.',
  shorthand: 'rate',
  params: {
    rate: {
      default: 4,
      min: 0.1,
      max: 20,
      unit: 'hz',
      drives: [{ select: 'lfo', param: 'frequency' }],
    },
    hard: { default: false, drives: [] },
  },
  options: { shape: { type: "'sine' | 'square'", default: "'sine'", description: 'The wobble.' } },
  build(__) {
    __.bus('in').chain().gain({ id: 'amp' }).to('out');
    __().lfo().modulate('#amp', 'gain');
  },
  trigger() {},
});

const dc = defineNode({
  type: 'dc',
  category: 'source',
  description: 'A constant.',
  params: {
    level: { default: 1, min: -1, max: 1, step: 0.1, description: 'The value.' },
    mode: { default: 'a', choices: ['a', 'b'] },
  },
  shorthand: 'level',
  triggerable: true,
  triggerOptions: { hold: { type: 'number', description: 'Seconds.' } },
  build(context) {
    const source = new ConstantSourceNode(context.audio);
    source.start();
    return { output: source, params: { level: source.offset, mode: () => undefined } };
  },
});

describe('describing node types without an engine', () => {
  it('reports the built-ins exactly as an engine registry does, field by field', async () => {
    const engine = await offlineEngine(0.01);
    const fromEngine = engine.registry.list();
    const described = describeNodeTypes();
    expect(described.map((info) => info.type)).toEqual(fromEngine.map((info) => info.type));
    for (const [index, info] of described.entries()) {
      const real = fromEngine[index]!;
      for (const key of Object.keys({ ...real, ...info }) as (keyof typeof real)[]) {
        expect(info[key], `${info.type}.${key}`).toEqual(real[key]);
      }
    }
    expect(described.length).toBe(builtinNodes.length);
  });

  it('reports user definitions as an engine given them does', async () => {
    const context = new OfflineAudioContext(1, 128, SAMPLE_RATE);
    const engine = await createEngine({ context, nodes: [tremolo, dc] });
    expect(describeNodeType(tremolo)).toEqual(engine.registry.describe('tremolo'));
    expect(describeNodeType(dc)).toEqual(engine.registry.describe('dc'));
    expect(describeNodeType(tremolo)).toMatchObject({
      isMacro: true,
      triggerable: true,
      shorthand: 'rate',
      category: 'dynamics',
    });
    expect(describeNodeType(dc).params.map((meta) => meta.kind)).toEqual(['number', 'choice']);
    expect(describeNodeTypes([...builtinNodes, tremolo, dc])).toEqual(engine.registry.list());
  });

  it('gives the editor the catalog an engine would', async () => {
    const context = new OfflineAudioContext(1, 128, SAMPLE_RATE);
    const engine = await createEngine({ context, nodes: [tremolo] });
    expect(catalogFromNodes().types).toEqual((await offlineEngine(0.01)).registry.list());
    const catalog = catalogFromNodes([...builtinNodes, tremolo], { buses: ['drums'] });
    expect(catalog.types).toEqual(catalogFromEngine(engine).types);
    expect(catalog.buses).toEqual(['drums']);
  });
});
