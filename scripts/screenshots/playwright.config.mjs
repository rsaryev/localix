import { defineConfig } from '@playwright/test'
import { captureRoot } from './runtime.mjs'
import path from 'node:path'

export default defineConfig({
  testDir: '.',
  testMatch: '*.pw.mjs', // Bun's normal *.test / *.spec discovery cannot pick this suite up.
  timeout: 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: path.join(captureRoot, 'test-results'),
  use: {
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 3,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    launchOptions: process.env.CAPTURE_BROWSER
      ? { executablePath: process.env.CAPTURE_BROWSER }
      : {},
    trace: 'retain-on-failure',
  },
})
