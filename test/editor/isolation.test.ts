/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

/**
 * The editor's dependencies (CodeMirror) must not reach anyone who only uses the audio engine. This
 * walks the import graph of each other entry point, from the source text, and checks that nothing
 * in it imports CodeMirror or anything under src/editor.
 */
const files = import.meta.glob<string>('../../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const sources = new Map(
  Object.entries(files).map(([path, text]) => [path.replace('../../src/', ''), text]),
);

/** The module names a file imports or re-exports from, static and dynamic. */
function importsOf(text: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

function resolve(from: string, specifier: string): string | null {
  const parts = from.split('/').slice(0, -1);
  for (const piece of specifier.split('/')) {
    if (piece === '.') continue;
    if (piece === '..') parts.pop();
    else parts.push(piece);
  }
  const base = parts.join('/');
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, base]) {
    if (sources.has(candidate)) return candidate;
  }
  return null;
}

/** Every file reachable from an entry, and every package it imports. */
function reach(entry: string): { files: Set<string>; packages: Set<string> } {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importsOf(sources.get(file) ?? '')) {
      if (!specifier.startsWith('.')) {
        packages.add(specifier);
        continue;
      }
      const target = resolve(file, specifier);
      expect(target, `${file} imports ${specifier}`).not.toBeNull();
      if (target) queue.push(target);
    }
  }
  return { files: seen, packages };
}

const CORE_ENTRIES = [
  'index.ts',
  'nodes/index.ts',
  'worklets/index.ts',
  'util/index.ts',
  'midi/index.ts',
  'remote/index.ts',
  'global/index.ts',
];

describe('the editor stays out of the other entry points', () => {
  it('finds the sources', () => {
    expect(sources.size).toBeGreaterThan(50);
    for (const entry of [...CORE_ENTRIES, 'editor/index.ts'])
      expect(sources.has(entry), entry).toBe(true);
  });

  it.each(CORE_ENTRIES)('%s imports no package and nothing under src/editor', (entry) => {
    const { files: reached, packages } = reach(entry);
    expect(reached.size).toBeGreaterThan(0);
    expect([...packages]).toEqual([]);
    expect([...reached].filter((file) => file.startsWith('editor/'))).toEqual([]);
  });

  it('the editor entry is the one that imports CodeMirror, and only CodeMirror and Lezer', () => {
    const { packages } = reach('editor/index.ts');
    expect(packages.size).toBeGreaterThan(3);
    for (const name of packages) expect(name).toMatch(/^@(codemirror|lezer)\//);
    expect(packages.has('@codemirror/view')).toBe(true);
  });

  it('the static highlighter imports nothing, so the docs pages do not load CodeMirror', () => {
    const { files: reached, packages } = reach('editor/highlight.ts');
    expect([...reached]).toEqual(['editor/highlight.ts']);
    expect([...packages]).toEqual([]);
  });

  it('the generated sources are reached only through a dynamic import', () => {
    for (const [file, text] of sources) {
      if (!text.includes('sources.generated')) continue;
      if (file === 'editor/sources.generated.ts') continue;
      expect(file).toBe('editor/sources.ts');
      expect(text).toContain("import('./sources.generated')");
      expect(text).not.toMatch(/^import [^;]*from '\.\/sources\.generated'/m);
    }
  });
});
