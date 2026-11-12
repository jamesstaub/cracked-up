/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { BREAK, BREAK_SECONDS, BREAK_SLICES, sliceGrid } from '../../demo/break';
import docsPage from '../../demo/docs.html?raw';
import { helpers, wrapUserCode } from '../../demo/helpers';
import { offlineEngine, ones } from '../core/setup';

describe('slice grid', () => {
  it('gives one more boundary than slices, evenly spaced from 0 to the length', () => {
    expect(sliceGrid(2, 4)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(sliceGrid(15, 128)).toHaveLength(129);
    expect(sliceGrid(15, 128)[1]).toBe(0.1171875);
    expect(sliceGrid(15, 128)[128]).toBe(15);
  });

  it('moves the whole grid later by an offset', () => {
    expect(sliceGrid(2, 2, 0.25)).toEqual([0.25, 1.25, 2.25]);
  });

  it('never makes fewer than one slice', () => {
    expect(sliceGrid(3, 0)).toEqual([0, 3]);
    expect(sliceGrid(3, 2.9)).toEqual([0, 1.5, 3]);
  });

  it('cuts the demo break into sixteenth notes at its own tempo', () => {
    expect(BREAK_SLICES).toBe(128);
    expect(BREAK_SECONDS).toBe(15);
    // One sixteenth note at the break's tempo.
    expect(BREAK_SECONDS / BREAK_SLICES).toBeCloseTo(60 / BREAK.bpm / 4, 12);
  });
});

/**
 * The docs section on slicing has examples that open in the live demo. Each must run as written with
 * the names the demo provides: `__`, `engine`, the helpers, and a 'break' buffer cut into slices.
 */
describe('docs: slicing a drum break', () => {
  const page = new DOMParser().parseFromString(docsPage, 'text/html');
  const blocks: string[] = [];
  for (
    let node = page.querySelector('#slicing')?.nextElementSibling;
    node && node.tagName !== 'H2';
    node = node.nextElementSibling
  ) {
    if (node.tagName === 'PRE' && !node.hasAttribute('data-static')) {
      blocks.push(node.textContent ?? '');
    }
  }

  it('has runnable examples, the last of them the breakcore one', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    expect(blocks[blocks.length - 1]).toContain('Breakcore');
    for (const block of blocks) expect(block).not.toContain('—');
  });

  it('runs every example and each one plays the break', async () => {
    for (const block of blocks) {
      // Long enough for the breakcore phrase of four bars at 172 bpm.
      const engine = await offlineEngine(6);
      engine.buffers.add(BREAK.key, ones(BREAK_SECONDS)).slices = sliceGrid(
        BREAK_SECONDS,
        BREAK_SLICES,
      );
      const errors: string[] = [];
      engine.on('error', (error) => errors.push(error.message));
      const program = new Function('__', 'engine', ...Object.keys(helpers), wrapUserCode(block));
      program(engine.$, engine, ...Object.values(helpers));
      engine.transport.start();
      const rendered = await engine.render();
      expect(errors, block.slice(0, 60)).toEqual([]);
      const heard = rendered.getChannelData(0).some((sample) => Math.abs(sample) > 0.01);
      expect(heard, block.slice(0, 60)).toBe(true);
    }
  });
});
