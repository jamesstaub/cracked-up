import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

const browserProject = (name: 'chromium' | 'firefox' | 'webkit') => ({
  test: {
    name,
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(
        name === 'chromium'
          ? {
              launchOptions: {
                // For the live recording test: sound without a click, and a pretend microphone.
                args: [
                  '--autoplay-policy=no-user-gesture-required',
                  '--use-fake-device-for-media-stream',
                  '--use-fake-ui-for-media-stream',
                ],
              },
            }
          : {},
      ),
      instances: [{ browser: name }],
    },
  },
});

export default defineConfig({
  test: {
    projects: [browserProject('chromium'), browserProject('firefox'), browserProject('webkit')],
  },
});
