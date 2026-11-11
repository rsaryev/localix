import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apiWatchRoots, createRestartScheduler, isReloadTrigger } from './dev-api.mjs'
import { repoRoot } from './lib/paths.mjs'
import { SOURCE_CONDITION, workspaceSourceRoots } from './lib/workspace-source.mjs'

async function writeJson(file: string, value: unknown) {
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, JSON.stringify(value))
}

describe('workspace packages read from source', () => {
  test('names the export condition every workspace package publishes its src under', async () => {
    const manifest = await Bun.file(join(repoRoot(), 'packages/agent/package.json')).json()
    expect(JSON.stringify(manifest.exports)).toContain(`"${SOURCE_CONDITION}"`)
  })

  test('collects the src of every workspace package a package reaches, transitively', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'localix-dev-api-'))
    try {
      await writeJson(join(repo, 'package.json'), { workspaces: ['apps/*', 'packages/*'] })
      await writeJson(join(repo, 'apps/api/package.json'), {
        name: '@x/api',
        dependencies: { '@x/a': 'workspace:*', hono: '^4' },
      })
      await writeJson(join(repo, 'packages/a/package.json'), {
        name: '@x/a',
        dependencies: { '@x/b': 'workspace:*' },
      })
      await writeJson(join(repo, 'packages/b/package.json'), {
        name: '@x/b',
        peerDependencies: { '@x/a': 'workspace:*' },
      })
      await writeJson(join(repo, 'packages/unused/package.json'), { name: '@x/unused' })

      expect(workspaceSourceRoots(repo, 'apps/api')).toEqual([
        join(repo, 'packages/a/src'),
        join(repo, 'packages/b/src'),
      ])
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  test('the API watches its own source, its migrations and the packages it imports', () => {
    const repo = repoRoot()
    const roots = apiWatchRoots(repo)
    expect(roots.slice(0, 2)).toEqual([
      join(repo, 'apps/api/src'),
      join(repo, 'apps/api/migrations'),
    ])
    expect(roots).toContain(join(repo, 'packages/agent/src'))
    expect(roots).toContain(join(repo, 'packages/engine-models/src'))
    expect(roots.some((root) => root.includes('/apps/ui/'))).toBe(false)
  })
})

describe('what restarts the API', () => {
  test('a source, migration or manifest change does', () => {
    for (const path of ['routes/chat.ts', 'ui/Panel.tsx', 'x.mts', 'schema.json', 'a.mjs']) {
      expect(isReloadTrigger(path)).toBe(true)
    }
  })

  test('tests, build output, dependencies and editor scratch files do not', () => {
    for (const path of [
      'routes/chat.test.ts',
      'routes/chat.dom.test.tsx',
      'routes/chat.integration.test.ts',
      'node_modules/x/index.js',
      'dist/index.js',
      '.turbo/turbo-build.log',
      'routes/.chat.ts.swp',
      'routes/chat.ts~',
      'routes/4913',
      'README.md',
    ]) {
      expect(isReloadTrigger(path)).toBe(false)
    }
  })
})

/** A clock the test moves by hand: no real time passes. */
function manualTimers() {
  let now = 0
  let nextId = 0
  const pending = new Map<number, { at: number; run: () => void }>()
  return {
    setTimer: (run: () => void, ms: number) => {
      nextId += 1
      pending.set(nextId, { at: now + ms, run })
      return nextId
    },
    clearTimer: (id: number) => void pending.delete(id),
    advance: async (ms: number) => {
      now += ms
      for (const [id, timer] of pending) {
        if (timer.at > now) continue
        pending.delete(id)
        timer.run()
      }
      await new Promise<void>((settle) => setImmediate(settle))
    },
  }
}

describe('restart scheduling', () => {
  test('a burst of changes (a save, a checkout, a formatter run) restarts once, naming them', async () => {
    const timers = manualTimers()
    const restarts: string[][] = []
    const scheduler = createRestartScheduler({
      delayMs: 200,
      ...timers,
      restart: async (paths) => void restarts.push(paths),
    })
    scheduler.notify('/r/a.ts')
    await timers.advance(150)
    scheduler.notify('/r/b.ts')
    scheduler.notify('/r/a.ts')
    await timers.advance(150)
    expect(restarts).toEqual([])
    await timers.advance(50)
    expect(restarts).toEqual([['/r/a.ts', '/r/b.ts']])
  })

  test('a change during a restart is not lost: it starts one more restart afterwards', async () => {
    const timers = manualTimers()
    const restarts: string[][] = []
    let finish = () => {}
    const scheduler = createRestartScheduler({
      delayMs: 200,
      ...timers,
      restart: (paths) => {
        restarts.push(paths)
        return new Promise<void>((done) => (finish = done))
      },
    })
    scheduler.notify('/r/a.ts')
    await timers.advance(200)
    scheduler.notify('/r/b.ts')
    await timers.advance(200)
    expect(restarts).toEqual([['/r/a.ts']])
    finish()
    await timers.advance(0)
    expect(restarts).toEqual([['/r/a.ts']])
    await timers.advance(200)
    expect(restarts).toEqual([['/r/a.ts'], ['/r/b.ts']])
  })

  test('cancel drops a pending restart', async () => {
    const timers = manualTimers()
    const restarts: string[][] = []
    const scheduler = createRestartScheduler({
      delayMs: 200,
      ...timers,
      restart: async (paths) => void restarts.push(paths),
    })
    scheduler.notify('/r/a.ts')
    scheduler.cancel()
    await timers.advance(1_000)
    expect(restarts).toEqual([])
  })
})
