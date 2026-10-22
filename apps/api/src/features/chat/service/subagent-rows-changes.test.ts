import { describe, expect, test } from 'bun:test'

import { createDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import { createCoreChangeFeed } from '../../changes/core-entities'
import { recordSessionChanges } from '../session-changes'
import { createSubagentRowsChanges } from './subagent-rows-changes'
import { createSubagentRowsLive, type Timers } from './subagent-rows-live'

async function setup() {
  const db = createDatabase()
  await migrateToLatest(db)
  const feed = createCoreChangeFeed(db)
  const armed = new Map<number, () => void>()
  let next = 0
  const timers: Timers = {
    set: (run) => {
      armed.set(++next, run)
      return next
    },
    clear: (handle) => void armed.delete(handle as number),
  }
  const fire = async () => {
    const due = [...armed.values()]
    armed.clear()
    for (const run of due) run()
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }
  let status = 'running'
  let draws = 0
  const pokes: string[] = []
  const live = createSubagentRowsLive({
    async compute() {
      draws++
      return {
        view: { active: true, rows: [{ id: 'child', content: `mapper · ${status}` }] },
        running: false,
        ids: ['child'],
      }
    },
    watched: () => true,
    publish: (userId) => void pokes.push(userId),
    locate: async () => [],
    timers,
  })
  const changes = createSubagentRowsChanges(live)
  await feed.subscribe('subagent-rows', changes.handlers, {
    kind: 'projector',
    reconcile: changes.reconcile,
  })
  await live.read('u1', 'root')
  return {
    db,
    feed,
    live,
    changes,
    armed,
    fire,
    pokes,
    draws: () => draws,
    setStatus: (next: string) => void (status = next),
  }
}

describe('subagent rows follow their owners’ notices', () => {
  test('a child’s status change redraws the rows and pokes once; a duplicate changes nothing', async () => {
    const t = await setup()
    t.setStatus('completed')
    await recordSessionChanges(t.db, 'u1', ['child'])
    // The same notice again: the burst is one redraw.
    await recordSessionChanges(t.db, 'u1', ['child'])
    await t.feed.settle()
    expect(t.armed.size).toBe(1)
    await t.fire()
    expect(t.draws()).toBe(2)
    expect(t.pokes).toEqual(['u1'])

    // The rows are drawn the same: redrawn, and nobody is poked.
    await recordSessionChanges(t.db, 'u1', ['child'])
    await t.feed.settle()
    await t.fire()
    expect(t.draws()).toBe(3)
    expect(t.pokes).toEqual(['u1'])
    await t.feed.close()
    t.live.close()
  })

  test('a gap is closed by the reconcile, which redraws every kept conversation', async () => {
    const t = await setup()
    t.setStatus('failed')
    await t.changes.reconcile()
    await t.fire()
    expect(t.pokes).toEqual(['u1'])
    await t.feed.close()
    t.live.close()
  })

  test('the conversation’s deletion forgets its rows; the next read draws them afresh', async () => {
    const t = await setup()
    await recordSessionChanges(t.db, 'u1', ['root', 'child'], 'deleted')
    await t.feed.settle()
    // Nothing is left to redraw for a conversation that is gone.
    await t.fire()
    expect(t.draws()).toBe(1)
    await t.live.read('u1', 'root')
    expect(t.draws()).toBe(2)
    await t.feed.close()
    t.live.close()
  })
})
