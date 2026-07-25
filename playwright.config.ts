import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  snapshotPathTemplate: 'tests/e2e/__screenshots__/{projectName}/{testFileName}/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  use: {
    baseURL: 'http://localhost:8080',
    storageState: 'tests/e2e/.auth/state.json',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'pnpm run build && pnpm exec vite preview --port 8080 --strictPort',
    url: 'http://localhost:8080',
    reuseExistingServer: false,
    timeout: 180_000,
    env: { NODE_OPTIONS: '--max-old-space-size=8192' },
  },
});
