/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import docsPage from '../../demo/docs.html?raw';
import { helpers, wrapUserCode } from '../../demo/helpers';
import { offlineEngine } from '../core/setup';

const page = new DOMParser().parseFromString(docsPage, 'text/html');

/** The blocks of one h3 section: from its heading to the next heading. */
function section(id: string): HTMLPreElement[] {
  const blocks: HTMLPreElement[] = [];
  for (
    let node = page.getElementById(id)?.nextElementSibling;
    node && !/^H[23]$/.test(node.tagName);
    node = node.nextElementSibling
  ) {
    if (node instanceof HTMLPreElement) blocks.push(node);
  }
  return blocks;
}

describe('docs: branching with a selection’s chain(), and onDisplay', () => {
  it('runs the branching example as the live demo does: the filter feeds both paths, and it is heard', async () => {
    const runnable = section('selection-chain').filter(
      (block) => !block.hasAttribute('data-static'),
    );
    expect(runnable).toHaveLength(1);
    const engine = await offlineEngine(1);
    const errors: string[] = [];
    engine.on('error', (error) => errors.push(error.message));
    const scope = engine.root.scope('live');
    const program = new Function(
      '__',
      ...Object.keys(helpers),
      wrapUserCode(runnable[0]!.textContent ?? ''),
    ) as (...values: unknown[]) => void;
    await scope.build((__) => program(__, ...Object.values(helpers)));
    expect(errors).toEqual([]);
    expect(scope.select('#tone').first()?.outputs).toHaveLength(2);
    const rendered = await engine.render();
    expect(rendered.getChannelData(0).some((sample) => Math.abs(sample) > 0.01)).toBe(true);
  });

  it('has the onDisplay section, and both are linked from where they are used', () => {
    expect(page.getElementById('display')).not.toBeNull();
    expect(section('display').length).toBeGreaterThan(0);
    expect(page.querySelectorAll('a[href="#display"]').length).toBeGreaterThanOrEqual(2);
    expect(page.querySelector('#connecting ~ p a[href="#selection-chain"]')).not.toBeNull();
    for (const block of [...section('selection-chain'), ...section('display')]) {
      expect(block.textContent).not.toContain('—');
    }
  });
});
