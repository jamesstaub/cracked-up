import { defineConfig } from 'vite';

export default defineConfig({
  // The sandbox demo's frame has no origin of its own, so its module requests are cross-origin.
  server: { cors: true },
});
