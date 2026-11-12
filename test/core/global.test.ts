import { describe, expect, it } from 'vitest';
import { __, engine, euclid, stop, transport } from '../../src/global';

describe('cracked-up/global', () => {
  it('provides a ready engine, `__` and its transport', () => {
    __().sine({ id: 'tone', gate: 'closed' }).gain(0.1).to('main');
    expect(__('#tone')).toHaveLength(1);
    expect(__.scope).toBe(engine.root);
    expect(transport).toBe(engine.transport);
    expect(euclid(2, 4)).toEqual([1, 0, 1, 0]);

    const sequence = transport.steps('tone', 'x.x.', () => {});
    expect(transport.get('tone')).toBe(sequence);
    // The context starts suspended, so nothing plays until play() is called from a user gesture.
    expect(transport.state).toBe('stopped');
    stop();
    transport.clear();
    __('*').dispose();
  });
});
