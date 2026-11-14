/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import docsPage from '../../demo/docs.html?raw';
import { helpers, wrapUserCode } from '../../demo/helpers';
import { offlineEngine, ones } from '../core/setup';

/**
 * The docs section on `main`, buses and inserts has examples that open in the live demo. Each must
 * run as written with the names the demo provides.
 */
describe('docs: buses and inserts', () => {
  const page = new DOMParser().parseFromString(docsPage, 'text/html');
  const blocks: string[] = [];
  for (
    let node = page.querySelector('#output')?.nextElementSibling;
    node && node.tagName !== 'H2';
    node = node.nextElementSibling
  ) {
    if (node.tagName === 'PRE' && !node.hasAttribute('data-static')) {
      blocks.push(node.textContent ?? '');
    }
  }

  it('teaches the short form and has runnable examples of it', () => {
    expect(page.querySelector('#inserts')).not.toBeNull();
    expect(page.querySelector('#bus-chain')).not.toBeNull();
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    expect(blocks.some((block) => block.includes("__.bus('drums').compressor("))).toBe(true);
    for (const block of blocks) expect(block).not.toContain('—');
  });

  it('runs every example without an error, and each is heard', async () => {
    for (const block of blocks) {
      const engine = await offlineEngine(2);
      for (const key of ['kick', 'snare', 'hat']) engine.buffers.add(key, ones(0.2));
      const errors: string[] = [];
      engine.on('error', (error) => errors.push(error.message));
      const program = new Function('__', 'engine', ...Object.keys(helpers), wrapUserCode(block));
      await engine.root.build((__) => program(__, engine, ...Object.values(helpers)));
      engine.transport.start();
      const rendered = await engine.render();
      expect(errors, block.slice(0, 60)).toEqual([]);
      const heard = rendered.getChannelData(0).some((sample) => Math.abs(sample) > 0.01);
      expect(heard, block.slice(0, 60)).toBe(true);
    }
  });
});
