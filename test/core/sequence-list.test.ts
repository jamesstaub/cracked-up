import { describe, expect, it } from 'vitest';
import { offlineEngine } from './setup';

describe('transport.sequences', () => {
  it("lists a scope's named sequences in the order they were first made", async () => {
    const engine = await offlineEngine(0.1);
    const a = engine.scope('a');
    const b = engine.scope('b');
    const names = (scope: typeof a) => scope.transport.sequences.map((sequence) => sequence.name);
    expect(names(a)).toEqual([]);

    a.transport.sequence('kick', { steps: 'x...' }, () => undefined);
    a.transport.sequence({ steps: 'x' }, () => undefined);
    a.transport.every('1 bar', () => undefined);
    const hat = a.transport.sequence('hat', { steps: 'xx' }, () => undefined);
    b.transport.sequence('kick', { steps: 'x' }, () => undefined);
    engine.transport.sequence('root', { steps: 'x' }, () => undefined);
    expect(names(a)).toEqual(['kick', 'hat']);
    expect(names(b)).toEqual(['kick']);
    expect(names(engine.root)).toEqual(['root']);
    expect(engine.transport.sequences.map((sequence) => sequence.name)).toEqual(['root']);
    expect(a.transport.sequences[1]).toBe(hat);
    expect(a.$.transport.sequences).toEqual(a.transport.sequences);

    // Replaced in place: the same sequence, in the same place.
    a.transport.sequence('kick', { steps: 'x.x.' }, () => undefined);
    expect(names(a)).toEqual(['kick', 'hat']);
    expect(a.transport.sequences[0]?.steps).toEqual([1, 0, 1, 0]);

    hat.stop();
    expect(names(a)).toEqual(['kick']);
    a.transport.clear();
    expect(names(a)).toEqual([]);
    expect(names(b)).toEqual(['kick']);
  });

  it('follows build(): what a run no longer declares leaves the list, and a failed run changes nothing', async () => {
    const engine = await offlineEngine(0.1);
    const scope = engine.scope('track');
    const names = () => scope.transport.sequences.map((sequence) => sequence.name);
    await scope.build((__) => {
      __.transport.sequence('one', { steps: 'x' }, () => undefined);
      __.transport.sequence('two', { steps: 'x' }, () => undefined);
    });
    expect(names()).toEqual(['one', 'two']);
    await scope.build((__) => {
      __.transport.sequence('three', { steps: 'x' }, () => undefined);
      __.transport.sequence('two', { steps: 'x' }, () => undefined);
    });
    expect(names()).toEqual(['two', 'three']);
    await expect(
      scope.build((__) => {
        __.transport.sequence('four', { steps: 'x' }, () => undefined);
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    expect(names()).toEqual(['two', 'three']);
  });
});
