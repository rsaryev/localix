import { defineConfig } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

export default defineConfig({
  testDir: '.',
  testMatch: 'highlights.pw.mjs',
  outputDir: path.join(os.tmpdir(), 'localix-landing-highlights'),
  timeout: 45_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    deviceScaleFactor: 3,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    locale: 'en-US',
    launchOptions: process.env.CAPTURE_BROWSER
      ? { executablePath: process.env.CAPTURE_BROWSER }
      : {},
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1600, height: 1000 } } },
    { name: 'tablet', use: { viewport: { width: 768, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
    { name: 'small-mobile', use: { viewport: { width: 320, height: 720 } } },
  ],
  webServer: {
    command: 'bun run dev:landing',
    cwd: repoRoot,
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
