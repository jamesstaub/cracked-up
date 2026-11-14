import { describe, expect, it } from 'vitest';
import type { Node } from '../../src';
import { offlineEngine } from './setup';

describe('node.autoId', () => {
  it('is true for a node made without an id, in and out of a build, and false otherwise', async () => {
    const engine = await offlineEngine(0.05);
    const scope = engine.scope('s');
    const flags = () => scope.select('*').nodes.map((node: Node) => [node.id, node.autoId]);
    scope.chain().sine({ id: 'osc' }).lowpass(500).to('main');
    expect(flags()).toEqual([
      ['osc', false],
      ['lowpass-0', true],
    ]);
    const code = (__: typeof scope.$) =>
      void __().sine({ id: 'osc' }).lowpass(500).gain(0.5).to('main');
    await scope.build(code);
    await scope.build(code);
    expect(flags()).toEqual([
      ['osc', false],
      ['lowpass-0', true],
      ['gain-0', true],
    ]);
    // A description names every node, so nothing made from one is automatic.
    const copy = engine.scope('copy');
    await copy.apply(scope.describe());
    expect(copy.select('*').nodes.map((node) => node.autoId)).toEqual([false, false, false]);
  });
});
