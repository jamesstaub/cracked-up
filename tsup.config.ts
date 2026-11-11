import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'nodes/index': 'src/nodes/index.ts',
    'worklets/index': 'src/worklets/index.ts',
    'util/index': 'src/util/index.ts',
    'global/index': 'src/global/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
});
