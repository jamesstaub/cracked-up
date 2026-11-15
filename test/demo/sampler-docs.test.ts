/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import docsPage from '../../demo/docs.html?raw';
import { helpers, wrapUserCode } from '../../demo/helpers';
import { SAMPLE_RATE, makeBuffer, offlineEngine } from '../core/setup';

/**
 * The docs section on samplers has examples that open in the live demo. Each must run as written
 * with the names the demo provides: `__`, `engine`, the helpers, and the 'kick', 'snare' and 'hat'
 * buffers.
 */
describe('docs: samplers and where their audio comes from', () => {
  const page = new DOMParser().parseFromString(docsPage, 'text/html');
  const blocks: string[] = [];
  for (
    let node = page.querySelector('#buffers')?.nextElementSibling;
    node && node.tagName !== 'H2';
    node = node.nextElementSibling
  ) {
    if (node.tagName === 'PRE' && !node.hasAttribute('data-static')) {
      blocks.push(node.textContent ?? '');
    }
  }

  it('has runnable examples for slices, loop points and changing the buffer', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    const all = blocks.join('\n');
    for (const name of [
      'slices',
      'addSlice',
      'moveSlice',
      'removeSlice',
      'loopStart',
      'setOption',
    ]) {
      expect(all, name).toContain(name);
    }
    for (const id of ['slice-editing', 'loop-points', 'swap-buffer', 'waveform-editor']) {
      expect(page.querySelector(`#${id}`), id).not.toBeNull();
    }
    for (const block of blocks) expect(block).not.toContain('—');
  });

  it('runs every example without an error, and each one makes a sound', async () => {
    for (const block of blocks) {
      const engine = await offlineEngine(2);
      // A burst that dies away over a quarter of a second, like the demo's drums.
      for (const name of ['kick', 'snare', 'hat']) {
        engine.buffers.add(
          name,
          makeBuffer(
            0.25,
            (i, t) => Math.exp(-t / 0.05) * Math.sin((i * 2 * Math.PI * 200) / SAMPLE_RATE),
          ),
        );
      }
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

  it('the grid examples of the slicing section give what they say', () => {
    const { sliceGrid, sliceByTempo } = helpers as {
      sliceGrid(seconds: number, count: number): number[];
      sliceByTempo(seconds: number, bpm: number, step: string): number[];
    };
    const text = page.querySelector('#slicing')?.parentElement?.textContent ?? '';
    expect(text).toContain("sliceByTempo(sound.duration, 128, '1/8')");
    expect(text).toContain('sliceGrid(sound.duration, 64)');
    expect(text).toContain('sliceByOnsets(sound.buffer');
    // For the demo's break, 15 s at 128 bpm, the two grids are the same 64 eighth notes.
    expect(sliceByTempo(15, 128, '1/8')).toEqual(sliceGrid(15, 64));
  });
});
