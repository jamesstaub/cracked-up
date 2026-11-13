import { defineConfig } from 'vite';

export default defineConfig({
  // Relative addresses, so the built site works wherever it is put (GitHub Pages serves it under
  // /cracked-up/).
  base: './',
  // The sandbox demo's frame has no origin of its own, so its module requests are cross-origin.
  server: { cors: true },
  preview: { cors: true },
  build: {
    // Paths here are relative to this folder.
    outDir: '../demo-dist',
    emptyOutDir: true,
    // The demo and sandbox pages share one chunk that holds CodeMirror (about 525 kB, 176 kB gzipped).
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: [
        'index.html',
        'docs.html',
        'sandbox.html',
        'sandbox-frame.html',
        'collaboration.html',
      ],
    },
  },
});
