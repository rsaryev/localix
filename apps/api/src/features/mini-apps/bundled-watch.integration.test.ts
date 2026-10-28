import { describe, expect, test } from 'bun:test'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { watchStagedMiniAppsRoot } from './bundled-watch'
import { STAGED_MARKER_FILE } from './staged-marker'

const until = async (check: () => boolean, ms: number) => {
  const deadline = Date.now() + ms
  while (!check() && Date.now() < deadline) await Bun.sleep(10)
}

describe('staged mini apps root watcher (real fs)', () => {
  const tmp = tempDirPerTest('staged-root-')

  test('an atomic marker rewrite reaches onChange through the native watcher', async () => {
    const dir = tmp()
    mkdirSync(join(dir, 'gpu-monitor'))
    writeFileSync(join(dir, STAGED_MARKER_FILE), '{"v":1}')
    let changes = 0
    const lines: string[] = []
    const handle = watchStagedMiniAppsRoot({
      root: dir,
      onChange: () => changes++,
      debounceMs: 30,
      log: (line) => lines.push(line),
      // Polling must not be what delivers this: fail loudly if the watch degraded.
      every: () => {
        throw new Error('polled')
      },
    })
    await Bun.sleep(150)
    writeFileSync(join(dir, 'gpu-monitor', 'mini-app.json'), '{}')
    const staging = join(dir, `${STAGED_MARKER_FILE}.42.tmp`)
    writeFileSync(staging, '{"v":2}')
    renameSync(staging, join(dir, STAGED_MARKER_FILE))
    await until(() => changes > 0, 5_000)
    // A settled rewrite raises exactly one change: leave room for a second one to show itself.
    await Bun.sleep(150)
    handle.close()
    expect(lines).toEqual([])
    expect(changes).toBe(1)
  })
})
