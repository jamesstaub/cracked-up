import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name: string): string => fileURLToPath(new URL(`./${name}.html`, import.meta.url));

export default defineConfig({
  // Relative addresses, so the built site works wherever it is put (GitHub Pages serves it under
  // /cracked-up/).
  base: './',
  // The sandbox demo's frame has no origin of its own, so its module requests are cross-origin.
  server: { cors: true },
  preview: { cors: true },
  build: {
    outDir: fileURLToPath(new URL('../demo-dist', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: page('index'),
        docs: page('docs'),
        sandbox: page('sandbox'),
        'sandbox-frame': page('sandbox-frame'),
        collaboration: page('collaboration'),
      },
    },
  },
});
