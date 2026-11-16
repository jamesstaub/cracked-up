import { describe, expect, it } from 'vitest';
import type { Duration } from '../../src';
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

  describe('sequence.options', () => {
    const nothing = (): void => undefined;

    it('is what the sequence was made with, not what it was worked out to', async () => {
      const t = (await offlineEngine(0.1)).transport;
      const counted = t.sequence('counted', { steps: 16, step: '1/16' }, nothing);
      expect(counted.options).toEqual({ steps: 16, step: '1/16' });
      expect(counted.steps).toHaveLength(16);

      const listed = t.sequence('listed', { steps: [1, 0, 1, 0], swing: 0.6 }, nothing);
      expect(listed.options).toEqual({ steps: [1, 0, 1, 0], swing: 0.6 });

      const written = t.sequence({ steps: 'x..x', span: '1 bar' }, nothing);
      expect(written.options).toEqual({ steps: 'x..x', span: '1 bar' });
      expect(written.steps).toEqual([1, 0, 0, 1]);

      expect(t.steps('short', 'x.x.', nothing).options).toEqual({ steps: 'x.x.' });
      expect(t.steps([1, 2], nothing).options).toEqual({ steps: [1, 2] });
    });

    it('follows update, and a named sequence made again', async () => {
      const t = (await offlineEngine(0.1)).transport;
      const sequence = t.sequence('part', { steps: 8, step: '1/8' }, nothing);
      sequence.update({ steps: [1, 0, 2] });
      expect(sequence.options).toEqual({ steps: [1, 0, 2], step: '1/8' });
      sequence.update({ probability: 0.5 });
      expect(sequence.options).toEqual({ steps: [1, 0, 2], step: '1/8', probability: 0.5 });

      // An update that is refused leaves the options as they were.
      expect(() => sequence.update({ span: '1 bar' })).toThrow(RangeError);
      expect(sequence.options).toEqual({ steps: [1, 0, 2], step: '1/8', probability: 0.5 });

      // Made again under the same name, the options are the new ones alone.
      expect(t.sequence('part', { steps: 'xx' }, nothing)).toBe(sequence);
      expect(sequence.options).toEqual({ steps: 'xx' });
    });

    it('is not changed by setStep, which changes a value and not the declaration', async () => {
      const t = (await offlineEngine(0.1)).transport;
      const counted = t.sequence({ steps: 4 }, nothing);
      counted.setStep(1, 0);
      expect(counted.steps).toEqual([1, 0, 1, 1]);
      expect(counted.options).toEqual({ steps: 4 });

      const listed = t.sequence({ steps: [1, 0, 1, 0] }, nothing);
      listed.setStep(1, 3);
      expect(listed.steps).toEqual([1, 3, 1, 0]);
      expect(listed.options.steps).toEqual([1, 0, 1, 0]);
      // An update without steps lays the pattern out from the options again.
      listed.update({ swing: 0.6 });
      expect(listed.steps).toEqual([1, 0, 1, 0]);
    });

    it('cannot be used to change the sequence', async () => {
      const t = (await offlineEngine(0.1)).transport;
      const given: { steps: number[]; step: Duration } = { steps: [1, 0, 1, 0], step: '1/8' };
      const sequence = t.sequence(given, nothing);
      const options = sequence.options as { steps: number[]; step: string };
      expect(options).not.toBe(given);
      expect(options.steps).not.toBe(given.steps);
      expect(Object.isFrozen(options)).toBe(true);
      expect(Object.isFrozen(options.steps)).toBe(true);
      expect(() => {
        options.step = '1/4';
      }).toThrow(TypeError);
      expect(() => {
        options.steps[0] = 9;
      }).toThrow(TypeError);

      // Nor does changing what was passed in.
      given.steps[0] = 9;
      given.step = '1/4';
      sequence.update({ swing: 0.6 });
      expect(sequence.steps).toEqual([1, 0, 1, 0]);
      expect(sequence.options).toEqual({ steps: [1, 0, 1, 0], step: '1/8', swing: 0.6 });
      expect(Object.isFrozen(sequence.options)).toBe(true);
    });
  });
});
