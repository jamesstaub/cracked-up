import { describe, expect, it } from 'vitest';
import { builtinHelpers, builtinSources } from '../../src/editor';
import { HELPER_SOURCES, NODE_SOURCES } from '../../src/editor/sources.generated';
import { builtinNodes } from '../../src/nodes/builtin';
import { testEngine } from './setup';

/**
 * `scripts/extract-sources.mjs` copies the source of every built-in node type and helper into
 * `sources.generated.ts`. These tests read that file, so they fail if the script misses one.
 * (`npm run lint` separately fails if the file is older than the sources it was made from.)
 */
describe('extracted sources', () => {
  it('has the source of every registered built-in type', async () => {
    const engine = await testEngine();
    const types = engine.registry.list().map((info) => info.type);
    expect(types.length).toBeGreaterThan(30);
    expect(Object.keys(NODE_SOURCES).sort()).toEqual([...types].sort());
    expect(builtinNodes.map((definition) => definition.type).sort()).toEqual([...types].sort());
  });

  it('each type’s source is its real definition: it names the type and where it is', () => {
    for (const [type, entry] of Object.entries(NODE_SOURCES)) {
      const first = entry.parts[0]!;
      expect(first.file, type).toMatch(/^src\/nodes\/\w+\.ts$/);
      expect(first.line, type).toBeGreaterThan(0);
      expect(first.endLine - first.line + 1, type).toBe(first.code.split('\n').length);
      expect(first.code, type).toContain(`'${type}'`);
      // Either the definition itself, or a call of the function that makes it, shown as well.
      const all = entry.parts.map((part) => part.code).join('\n');
      expect(all, type).toMatch(/define(Node|Macro)\(/);
      expect(first.code, type).toMatch(new RegExp(`^(/\\*\\*|//|export const ${type}\\b)`));
    }
  });

  it('includes the comment above a definition', () => {
    expect(NODE_SOURCES.sampler!.parts[0]!.code).toMatch(/^\/\*\*\n \* Plays a buffer\./);
  });

  it('includes the function that builds a type made by one', () => {
    const lowpass = NODE_SOURCES.lowpass!;
    expect(lowpass.parts).toHaveLength(2);
    expect(lowpass.parts[1]!.label).toBe('filter(), which builds it');
    expect(lowpass.parts[1]!.code).toContain('new BiquadFilterNode(');
  });

  it('names the Web Audio node a wrapper is built on, and none for a macro', () => {
    expect(NODE_SOURCES.lowpass!.native).toEqual(['BiquadFilterNode']);
    expect(NODE_SOURCES.gain!.native).toEqual(['GainNode']);
    expect(NODE_SOURCES.panner!.native).toContain('StereoPannerNode');
    expect(NODE_SOURCES.tapedelay!.native).toEqual([]);
    expect(NODE_SOURCES.polysynth!.native).toEqual([]);
  });

  it('has the source of every helper', () => {
    const helpers = builtinHelpers();
    expect(helpers.length).toBeGreaterThan(40);
    expect(Object.keys(HELPER_SOURCES).sort()).toEqual(helpers.map((h) => h.name).sort());
    for (const helper of helpers) {
      const part = HELPER_SOURCES[helper.name]!.parts[0]!;
      expect(part.file, helper.name).toMatch(/^src\/util\/\w+\.ts$/);
      expect(part.code, helper.name).toMatch(/export (function|const) \w+/);
    }
    expect(HELPER_SOURCES.euclid!.parts[0]!.code).toContain('export function euclid(');
  });

  it('is loaded on demand by builtinSources, which answers null for anything else', async () => {
    expect((await builtinSources('type', 'reverb'))?.parts[0]?.file).toBe('src/nodes/reverb.ts');
    expect((await builtinSources('helper', 'euclid'))?.parts[0]?.file).toBe('src/util/pattern.ts');
    expect(await builtinSources('type', 'no-such-type')).toBeNull();
    expect(await builtinSources('type', 'constructor')).toBeNull();
    expect(await builtinSources('helper', 'lowpass')).toBeNull();
  });
});
