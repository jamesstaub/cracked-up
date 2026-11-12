import { describe, expect, it } from 'vitest';
import { HELPER_DOCS, HELPER_GROUPS, helpers, wrapUserCode } from '../../demo/helpers';
import * as global from '../../src/global';
import * as util from '../../src/util';
import * as transforms from '../../src/util/transforms';
import { offlineEngine } from '../core/setup';

/** Runs an expression with every helper in scope, as demo code would. */
function evaluate(expression: string, setup = ''): unknown {
  return new Function(...Object.keys(helpers), `"use strict"; ${setup}\nreturn (${expression});`)(
    ...Object.values(helpers),
  );
}

/** Numbers to three decimals, so `0.501` in the docs matches 0.50118... */
const rounded = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => (typeof v === 'number' ? Number(v.toFixed(3)) : v));

/**
 * The demos and the docs page share one list of helpers. Every entry must be complete, and the
 * result shown beside each example must be what the example really gives.
 */
describe('demo helpers', () => {
  it('describes every helper', () => {
    expect(HELPER_DOCS.length).toBeGreaterThan(20);
    const names = HELPER_DOCS.map((doc) => doc.name);
    expect(new Set(names).size).toBe(names.length);
    for (const group of HELPER_GROUPS) expect(group.helpers.length).toBeGreaterThan(0);
    for (const doc of HELPER_DOCS) {
      expect(typeof doc.fn, doc.name).toBe('function');
      expect(doc.signature.startsWith(`${doc.name}(`), doc.name).toBe(true);
      expect(doc.description.length, doc.name).toBeGreaterThan(10);
      expect(doc.description, doc.name).not.toContain('—');
      expect(doc.example, doc.name).toContain(doc.name);
      expect(doc.result, doc.name).not.toBe('');
    }
  });

  it('shows the result each example really gives', () => {
    const wrong: string[] = [];
    for (const doc of HELPER_DOCS) {
      const actual = rounded(evaluate(doc.example, doc.setup));
      const shown = rounded(evaluate(doc.result));
      if (actual !== shown) wrong.push(`${doc.example}: docs say ${shown}, it gives ${actual}`);
    }
    expect(wrong).toEqual([]);
  });

  it('offers each helper under its Cracked name too', () => {
    for (const doc of HELPER_DOCS) {
      expect(helpers[doc.name], doc.name).toBe(doc.fn);
      if (doc.alias) expect(helpers[doc.alias], doc.alias).toBe(doc.fn);
    }
  });

  it('lets demo code declare a name that a helper already has', () => {
    const run = (code: string): unknown => {
      const box: { value?: unknown } = {};
      new Function('box', ...Object.keys(helpers), wrapUserCode(code))(
        box,
        ...Object.values(helpers),
      );
      return box.value;
    };
    expect(run('const random = createRandom(4); const scale = 2; box.value = scale;')).toBe(2);
    expect(run('box.value = scale(5, 0, 10, 0, 1);')).toBe(0.5);
    // A comment on the last line must not swallow the closing of the block.
    expect(run('box.value = 1; // done')).toBe(1);
  });

  it('lists every pattern helper that cracked-up/util has', () => {
    for (const [name, value] of Object.entries(transforms)) {
      if (typeof value === 'function') expect(helpers[name], name).toBe(value);
    }
  });

  it('runs the pattern helpers together as demo code would', () => {
    expect(
      evaluate(
        "patternToString(or(concat(sieve(8, [3, 0]), repeat('.', 8)), rotate(concat(spread('xx', 2), repeat('.', 12)), -10)))",
      ),
    ).toBe('x..x..x...x.x...');
    expect(
      evaluate('indexes(invert(binaryPattern(binaryToNumber(onOffPattern(2, 1, 2)))))'),
    ).toEqual([2, 5]);
  });

  it('uses the names cracked-up/util and cracked-up/global export', () => {
    for (const [name, fn] of Object.entries(helpers)) {
      expect((util as Record<string, unknown>)[name], `util.${name}`).toBe(fn);
      expect((global as Record<string, unknown>)[name], `global.${name}`).toBe(fn);
    }
    global.stop();
  });
});

describe('helpers with the engine’s seeded random source', () => {
  /** A melody chosen by the helpers, drawn from `engine.random`, rendered offline. */
  async function melody(seed: number): Promise<{ notes: number[]; audio: Float32Array }> {
    const context = new OfflineAudioContext(1, 48000, 48000);
    const { createEngine } = await import('../../src');
    const engine = await createEngine({ context, seed });
    const notes: number[] = [];
    engine.$().sine({ id: 'lead', gate: 'closed' }).gain(0.2).to('main');
    engine.transport.bpm = 240;
    engine.transport.sequence('lead', { steps: util.euclid(5, 8), step: '1/16' }, (ev) => {
      if (!ev.value || !util.chance(0.8, engine.random)) return;
      const frequency = util.randomScale('minor', 4, 5, engine.random);
      notes.push(frequency);
      engine
        .select('#lead')
        .set({ frequency })
        .trigger({ duration: ev.duration * 0.5 });
    });
    engine.transport.start();
    const rendered = await engine.render();
    return { notes, audio: rendered.getChannelData(0).slice() };
  }

  it('renders the same notes and the same audio twice, and different ones for another seed', async () => {
    const first = await melody(7);
    const second = await melody(7);
    const other = await melody(8);
    expect(first.notes.length).toBeGreaterThan(4);
    expect(second.notes).toEqual(first.notes);
    expect(second.audio).toEqual(first.audio);
    expect(other.notes).not.toEqual(first.notes);
    expect(first.audio.some((sample) => sample !== 0)).toBe(true);
  });

  it('an offline engine is seeded by default', async () => {
    const a = await offlineEngine(0.01);
    const b = await offlineEngine(0.01);
    expect(util.shuffle([1, 2, 3, 4, 5, 6, 7, 8], a.random)).toEqual(
      util.shuffle([1, 2, 3, 4, 5, 6, 7, 8], b.random),
    );
  });
});
