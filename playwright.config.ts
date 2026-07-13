import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Preinstalled Chromium in CI/dev containers; Playwright's own download
// elsewhere (PLAYWRIGHT_BROWSERS_PATH controls discovery).
const pinnedChromium = '/opt/pw-browsers/chromium';
const executablePath = existsSync(pinnedChromium) ? pinnedChromium : undefined;

export default defineConfig({
  testDir: 'test/browser',
  timeout: 30_000,
  globalSetup: './test/browser/global-setup.ts',
  webServer: [
    {
      command: 'node test/browser/serve.mjs',
      port: 8377,
      reuseExistingServer: true,
    },
    {
      command: 'pnpm exec vite --config demo/vite.config.ts',
      port: 5183,
      reuseExistingServer: true,
    },
  ],
  use: {
    baseURL: 'http://localhost:8377',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--use-file-for-fake-video-capture=test/browser/.artifacts/qr-feed.y4m',
      ],
    },
  },
});
