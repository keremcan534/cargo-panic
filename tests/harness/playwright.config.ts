/**
 * Runs only the Canvas 2D harness spec, against the Vite dev server the spec
 * starts itself on port 5199 - no production build, no preview server.
 *
 *   npx playwright test -c tests/harness/playwright.config.ts
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../e2e',
  testMatch: 'canvas2d-harness.spec.ts',
  // Screenshots go to test-results/a2 (relative to the repo root); keep
  // Playwright's own artefacts out of that folder.
  outputDir: '../../test-results/harness-artifacts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.E2E_CHROMIUM || undefined },
    trace: 'retain-on-failure',
  },
});
