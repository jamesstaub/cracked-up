import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

const browserProject = (name: 'chromium' | 'firefox' | 'webkit') => ({
  test: {
    name,
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: name }],
    },
  },
});

export default defineConfig({
  test: {
    projects: [browserProject('chromium'), browserProject('firefox'), browserProject('webkit')],
  },
});
