import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'nodes/index': 'src/nodes/index.ts',
    'worklets/index': 'src/worklets/index.ts',
    'util/index': 'src/util/index.ts',
    'global/index': 'src/global/index.ts',
    'remote/index': 'src/remote/index.ts',
    'midi/index': 'src/midi/index.ts',
    'editor/index': 'src/editor/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  // CodeMirror is a peer dependency of cracked-up/editor only: it is never bundled.
  external: [/^@codemirror\//, /^@lezer\//],
});
