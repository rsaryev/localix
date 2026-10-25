import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Kysely } from 'kysely'
import { tempDirPerTest } from '@localixai/testing'
import { capabilityStores } from '../../../bootstrap/capability-stores'
import { createDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import type { AppDatabase } from '../../../db/types'
import { recordCoreChanges } from '../../changes/core-entities'
import { agentFolders } from '../catalog/scan'
import { createAgentBindings } from './bindings'
import { GRACE_MS } from './plan'
import { createAgentWatcher } from './watcher'

const file = (name: string) => `---\nname: ${name}\ndescription: ${name}\n---\nYou are ${name}.`

describe('agent watcher', () => {
  const base = tempDirPerTest('agent-watcher-')
  let db: Kysely<AppDatabase>
  let clock = 0
  let counter = 0
  let timers: Array<{ at: number; fn: () => void; live: boolean }> = []
  let watched: Array<{
    dir: string
    recursive: boolean
    onEvent: (name: string | null) => void
    onError: () => void
    open: boolean
  }> = []
  const home = () => join(base(), 'home')
  const agents = () => join(home(), '.claude', 'agents')
  const put = async (name: string) => {
    await fs.mkdir(agents(), { recursive: true })
    await fs.writeFile(join(agents(), `${name}.md`), file(name))
  }
  const advance = async (ms: number) => {
    clock += ms
    for (const timer of timers.filter((t) => t.live && t.at <= clock).sort((a, b) => a.at - b.at)) {
      timer.live = false
      timer.fn()
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const rows = () =>
    db.selectFrom('capability_source').selectAll().where('kind', '=', 'agent').execute()
  const notices = async () =>
    (await db.selectFrom('change_events').selectAll().where('entity', '=', 'agent').execute()).map(
      (row) => row.op,
    )
  const make = () => {
    const folders = async () =>
      agentFolders({ cwd: null, home: home(), managedDir: join(base(), 'managed') })
    const bindings = createAgentBindings({
      db,
      stores: capabilityStores,
      folders,
      now: () => clock,
      newId: () => `cc:test-${++counter}`,
    })
    return createAgentWatcher({
      reconcile: (project) => bindings.snapshot('u', project),
      folders,
      projects: async () => [],
      resync: () => recordCoreChanges(db, { entity: 'agent', op: 'resync' }),
      watch: (dir, recursive, onEvent, onError) => {
        const entry = { dir, recursive, onEvent, onError, open: true }
        watched.push(entry)
        return () => {
          entry.open = false
        }
      },
      after: (ms, fn) => {
        const timer = { at: clock + ms, fn, live: true }
        timers.push(timer)
        return () => {
          timer.live = false
        }
      },
      now: () => clock,
    })
  }

  beforeEach(async () => {
    db = createDatabase()
    await migrateToLatest(db)
    clock = 1_000_000
    counter = 0
    timers = []
    watched = []
  })
  afterEach(() => db.destroy())

  test('starts by watching the folders, binding what is there and announcing a resync', async () => {
    await put('a')
    const watcher = make()
    await watcher.start()
    expect(watched.filter((w) => w.open).map((w) => [w.dir, w.recursive])).toEqual([
      [join(home(), '.claude'), false],
      [agents(), true],
    ])
    expect((await rows()).map((row) => row.name)).toEqual(['cc:test-1'])
    expect(await notices()).toEqual(['resync', 'upserted'])
    watcher.stop()
  })

  test('an event settles, then the new file is bound once', async () => {
    const watcher = make()
    await put('a')
    await watcher.start()
    await put('b')
    const recursive = watched.find((w) => w.recursive)!
    recursive.onEvent('b.md')
    recursive.onEvent('b.md')
    await advance(100)
    expect(await rows()).toHaveLength(1)
    await advance(300)
    expect((await rows()).map((row) => row.name)).toEqual(['cc:test-1', 'cc:test-2'])
    watcher.stop()
  })

  test('a vanished file is purged when its grace has run, without another event', async () => {
    const watcher = make()
    await put('a')
    await watcher.start()
    await fs.rm(join(agents(), 'a.md'))
    watched.find((w) => w.recursive)!.onEvent('a.md')
    await advance(300)
    expect(await rows()).toHaveLength(1)
    await advance(GRACE_MS)
    expect(await rows()).toHaveLength(0)
    expect((await notices()).at(-1)).toBe('deleted')
    watcher.stop()
  })

  test('the agents folder appearing later is watched, and an error starts over with a resync', async () => {
    await fs.mkdir(join(home(), '.claude'), { recursive: true })
    const watcher = make()
    await watcher.start()
    expect(watched.filter((w) => w.open).map((w) => w.recursive)).toEqual([false])
    await put('a')
    watched[0]!.onEvent('agents')
    await advance(0)
    expect(watched.filter((w) => w.open).map((w) => w.recursive)).toEqual([false, true])
    const before = (await notices()).filter((op) => op === 'resync').length
    watched.find((w) => w.open)!.onError()
    await advance(300)
    expect((await notices()).filter((op) => op === 'resync')).toHaveLength(before + 1)
    expect(watched.filter((w) => w.open)).toHaveLength(2)
    watcher.stop()
    expect(watched.filter((w) => w.open)).toHaveLength(0)
  })
})
