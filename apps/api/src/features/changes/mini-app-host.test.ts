import { describe, expect, test } from 'bun:test'
import type { CoreDeletion, MiniAppChange } from '@localixai/mini-app-sdk/backend'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCoreChangeFeed, recordCoreChanges } from './core-entities'
import { createMiniAppChangeHosts } from './mini-app-host'

async function setup() {
  const db = createDatabase()
  await migrateToLatest(db)
  const logged: string[] = []
  const core = createCoreChangeFeed(db)
  const hosts = createMiniAppChangeHosts({ db, core, log: (event) => logged.push(event) })
  return { db, hosts, logged }
}

/**
 * Yields to the event loop until `done` holds: delivery runs through the database, so a test
 * waits for what it expects rather than for a fixed time. Fails at the deadline.
 */
async function until(done: () => boolean | Promise<boolean>, what: string) {
  const deadline = Date.now() + 5000
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error(`gave up waiting for ${what}`)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

describe('host.changes', () => {
  test("a mini app's notices reach its own consumer, never another mini app's", async () => {
    const { hosts } = await setup()
    const board = hosts.forMiniApp('board')
    const notes = hosts.forMiniApp('notes')
    const seenByBoard: MiniAppChange[] = []
    const seenByNotes: MiniAppChange[] = []
    const stopBoard = await board.subscribe('index', (change) => void seenByBoard.push(change))
    const stopNotes = await notes.subscribe('index', (change) => void seenByNotes.push(change))
    board.record([
      { entity: 'card', op: 'upserted', ref: { id: 'c1' } },
      { entity: 'card', op: 'resync' },
    ])
    notes.record([{ entity: 'note', op: 'resync' }])
    // Each hears its own; neither has the other's by the time both have theirs.
    await until(() => seenByBoard.length >= 2 && seenByNotes.length >= 1, 'both consumers')
    expect(seenByBoard).toEqual([
      { entity: 'card', op: 'upserted', ref: { id: 'c1' } },
      { entity: 'card', op: 'resync' },
    ])
    expect(seenByNotes).toEqual([{ entity: 'note', op: 'resync' }])
    await stopBoard()
    await stopNotes()
    await hosts.close()
  })

  test('a kind with an invalid name is dropped and logged, the rest recorded', async () => {
    const { db, hosts, logged } = await setup()
    hosts.forMiniApp('board').record([
      { entity: 'Bad Name', op: 'resync' },
      { entity: 'card', op: 'resync' },
    ])
    const stored = () => db.selectFrom('change_events').select(['stream', 'entity']).execute()
    await until(async () => (await stored()).length >= 1, 'the valid notice to be recorded')
    const rows = await stored()
    expect(rows).toEqual([{ stream: 'mini-app:board', entity: 'card' }])
    expect(logged).toContain('changes.mini_app_invalid_entity')
    await hosts.close()
  })

  test("a mini app hears the core's deletions, refs only; a renamed agent is not deleted", async () => {
    const { db, hosts } = await setup()
    const seen: CoreDeletion[] = []
    const stop = await hosts
      .forMiniApp('board')
      .followCoreDeletions('cleanup', (deletion) => void seen.push(deletion))
    await recordCoreChanges(db, [
      { entity: 'agent', op: 'deleted', ref: { id: 'old', scope: 'global', agentId: 'a1' } },
      { entity: 'agent', op: 'upserted', ref: { id: 'new', scope: 'global', agentId: 'a1' } },
      { entity: 'agent', op: 'deleted', ref: { id: 'gone', scope: 'global', agentId: 'a2' } },
      { entity: 'chat.session', op: 'deleted', ref: { id: 's1', userId: 'u1' } },
      { entity: 'chat.session', op: 'upserted', ref: { id: 's2', userId: 'u1' } },
      { entity: 'project', op: 'deleted', ref: { id: 'p1', userId: 'u1' } },
      {
        entity: 'provider.connection',
        op: 'deleted',
        ref: { id: 'c1', userId: 'u1', providerId: 'openai' },
      },
      { entity: 'skill', op: 'deleted', ref: { name: 'x', scope: 'global' } },
    ])
    await until(() => seen.length >= 4, 'the deletions')
    expect(seen).toEqual([
      { entity: 'agent', ref: { id: 'gone', scope: 'global', agentId: 'a2' } },
      { entity: 'chat', ref: { id: 's1', userId: 'u1' } },
      { entity: 'project', ref: { id: 'p1', userId: 'u1' } },
      { entity: 'provider.connection', ref: { id: 'c1', userId: 'u1', providerId: 'openai' } },
    ])
    await stop()
    await hosts.close()
  })

  test('following again under the same name replaces the earlier follower', async () => {
    const { db, hosts } = await setup()
    const first: CoreDeletion[] = []
    const second: CoreDeletion[] = []
    const board = hosts.forMiniApp('board')
    await board.followCoreDeletions('cleanup', (deletion) => void first.push(deletion))
    const stop = await board.followCoreDeletions('cleanup', (d) => void second.push(d))
    await recordCoreChanges(db, { entity: 'project', op: 'deleted', ref: { id: 'p', userId: 'u' } })
    await until(() => second.length >= 1, 'the later follower')
    expect(first).toEqual([])
    expect(second).toHaveLength(1)
    await stop()
    await hosts.close()
  })
})

describe('host.changes across a mini app reload', () => {
  test('the reloaded backend subscribes under the same consumer name', async () => {
    const { hosts } = await setup()
    const first = hosts.forMiniApp('board')
    const second = hosts.forMiniApp('board')
    const seen: string[] = []
    await first.subscribe('index', () => void seen.push('old'))
    await second.subscribe('index', () => void seen.push('new'))
    first.record([{ entity: 'card', op: 'resync' }])
    await until(() => seen.length >= 1, 'the reloaded handler')
    expect(seen).toEqual(['new'])
    await hosts.releaseMiniApp('board')
    await hosts.close()
  })
})
