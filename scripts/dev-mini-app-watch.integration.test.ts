import { describe, expect, test } from 'bun:test'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { watchMiniAppsForRestage } from './dev-mini-app-watch.mjs'

describe('dev mini app watcher', () => {
  // Bun's recursive fs.watch on macOS delivered a fraction of a burst like a scaffold's, so a
  // freshly created mini app could miss its re-stage. The native watcher sees every mini app.
  test('a real scaffold burst re-stages every mini app it touched (native watcher)', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'dev-mini-app-watch-'))
    try {
      // A checkout has both bundled folders.
      mkdirSync(join(repoRoot, 'mini-apps'))
      mkdirSync(join(repoRoot, 'plugins'))
      const restaged = new Set<string>()
      const lines: string[] = []
      const watcher = watchMiniAppsForRestage({
        repoRoot,
        outMiniApps: '/staged',
        debounceMs: 30,
        log: (line) => lines.push(line),
        restage: ({ name }) => {
          restaged.add(name)
          return { staged: true }
        },
      })
      await Bun.sleep(150)
      for (const miniApp of ['alpha', 'beta', 'gamma']) {
        mkdirSync(join(repoRoot, 'plugins', miniApp, 'backend'), { recursive: true })
        writeFileSync(join(repoRoot, 'plugins', miniApp, 'plugin.json'), '{}')
        writeFileSync(join(repoRoot, 'plugins', miniApp, 'backend', 'index.ts'), 'export {}\n')
      }
      await Bun.sleep(600)
      watcher.close()
      expect(lines.filter((line) => line.includes('stopped'))).toEqual([])
      expect([...restaged].sort()).toEqual(['alpha', 'beta', 'gamma'])
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })
})
