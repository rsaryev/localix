import { afterEach, describe, expect, it } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { INBOX_RETENTION_MS, type InboxChange, type RaiseFact } from './contracts'
import { createNotificationJournal } from './journal'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

async function journal(now = () => 1_000_000) {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  return createNotificationJournal({
    db,
    now,
    redact: (_user, text) => text.replaceAll('sk-secret', '[redacted]'),
  })
}

const fact = (over: Partial<RaiseFact> = {}): RaiseFact => ({
  key: 'hitl:r1',
  topic: 'hitl.required',
  category: 'human-input',
  severity: 'warning',
  title: 'Approve deployment',
  origin: { kind: 'session', sessionId: 'S1', projectId: null },
  ...over,
})

const U = 'local-user'

describe('the notification journal', () => {
  it('records a fact once, however often it is replayed', async () => {
    const j = await journal()
    j.record(U, fact())
    j.record(U, fact())
    await j.flush()
    j.record(U, fact({ title: 'replayed' }))
    await j.flush()
    const { changes, full } = await j.sync(U, 0)
    expect(full).toBe(true)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ entry: { key: 'hitl:r1', title: 'Approve deployment' } })
  })

  it('settles, and a settled lifecycle fact is not reopened by a replay', async () => {
    const j = await journal()
    j.record(
      U,
      fact({ actions: [{ id: 'respond', label: 'Respond', kind: 'navigate', available: true }] }),
    )
    j.settle(U, { key: 'hitl:r1', reason: 'answered' })
    j.record(U, fact())
    await j.flush()
    const [change] = (await j.sync(U, 0)).changes
    expect(change).toMatchObject({ entry: { state: 'settled', settleReason: 'answered' } })
    expect('entry' in change! && change.entry.actions?.[0]?.available).toBe(false)
  })

  it('reopens a standing condition that comes back, counting it', async () => {
    const j = await journal()
    const down = fact({
      key: 'condition:mcp:github',
      topic: 'application.notification',
      condition: true,
    })
    j.record(U, down)
    j.settle(U, { prefix: 'condition:mcp:', reason: 'fixed' })
    j.record(U, down)
    await j.flush()
    const [change] = (await j.sync(U, 0)).changes
    expect(change).toMatchObject({ entry: { state: 'open', occurrenceCount: 2 } })
  })

  it('settles a prefix but keeps the row still true', async () => {
    const j = await journal()
    j.record(U, fact({ key: 'condition:doc:a:1', condition: true }))
    j.record(U, fact({ key: 'condition:doc:a:2', condition: true }))
    j.settle(U, { prefix: 'condition:doc:a:', keep: 'condition:doc:a:2', reason: 'superseded' })
    await j.flush()
    const states = Object.fromEntries(
      (await j.sync(U, 0)).changes.map((c) => ('entry' in c ? [c.entry.key, c.entry.state] : [])),
    )
    expect(states).toEqual({ 'condition:doc:a:1': 'settled', 'condition:doc:a:2': 'open' })
  })

  it('folds an identical anonymous repeat into one counted row', async () => {
    const j = await journal()
    const copy = (key: string) =>
      fact({
        key,
        topic: 'application.notification',
        category: 'system',
        severity: 'error',
        title: 'Could not copy',
        coalesce: true,
      })
    j.record(U, copy('app:1'))
    j.record(U, copy('app:2'))
    await j.flush()
    const { changes } = await j.sync(U, 0)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ entry: { key: 'app:1', occurrenceCount: 2 } })
  })

  it('serves deltas after a cursor, removals included, and publishes each change live', async () => {
    const j = await journal()
    const live: InboxChange[] = []
    j.subscribe(U, (change) => live.push(change))
    j.record(U, fact())
    await j.flush()
    const { cursor } = await j.sync(U, 0)
    await j.apply(U, [{ id: 'op-1', op: 'remove', key: 'hitl:r1' }])
    const delta = await j.sync(U, cursor)
    expect(delta.full).toBe(false)
    expect(delta.changes).toEqual([{ seq: cursor + 1, removedKey: 'hitl:r1' }])
    expect(live.map((change) => ('entry' in change ? 'entry' : 'removed'))).toEqual([
      'entry',
      'removed',
    ])
  })

  it('makes a resent client op a no-op', async () => {
    const j = await journal()
    const op = { id: 'outbox-7', op: 'raise' as const, fact: fact({ key: 'client:1' }) }
    expect(await j.apply(U, [op])).toHaveLength(1)
    await j.apply(U, [{ id: 'x', op: 'remove', key: 'client:1' }])
    // The same batch again — an outbox retry after a lost response — must not resurrect the row.
    expect(await j.apply(U, [op])).toEqual([])
  })

  it('clear keeps pending requests and open conditions', async () => {
    const j = await journal()
    j.record(
      U,
      fact({
        actions: [
          {
            id: 'respond',
            label: 'Respond',
            kind: 'navigate',
            target: { kind: 'session', sessionId: 'S1', projectId: null, focus: 'interaction' },
            available: true,
          },
        ],
      }),
    )
    j.record(U, fact({ key: 'condition:x', condition: true }))
    j.record(U, fact({ key: 'run:1', topic: 'run.completed', severity: 'success', title: 'Done' }))
    await j.flush()
    await j.apply(U, [{ id: 'c', op: 'clear' }])
    const keys = (await j.sync(U, 0)).changes.map((c) => ('entry' in c ? c.entry.key : ''))
    expect(keys.sort()).toEqual(['condition:x', 'hitl:r1'])
  })

  it('reads through a position, and scrubs secrets before storing', async () => {
    const j = await journal()
    j.record(U, fact({ body: 'token sk-secret leaked' }))
    await j.flush()
    const { cursor } = await j.sync(U, 0)
    await j.apply(U, [{ id: 'r', op: 'read_through', seq: cursor }])
    const [change] = (await j.sync(U, 0)).changes
    expect(change).toMatchObject({ entry: { readAt: 1_000_000, body: 'token [redacted] leaked' } })
  })

  it('never lets one bad op take the batch down, and never throws at the producer', async () => {
    const j = await journal()
    expect(() => j.record(U, fact({ key: 'ok' }))).not.toThrow()
    // A settle that names neither a key nor a prefix is malformed; its neighbours still land.
    j.settle(U, { reason: 'fixed' } as never)
    j.record(U, fact({ key: 'ok-2' }))
    await j.flush()
    expect((await j.sync(U, 0)).changes).toHaveLength(2)
  })

  it('prunes old settled rows but never an old pending one, and tells live clients', async () => {
    let clock = 1_000_000
    const j = await journal(() => clock)
    const live: InboxChange[] = []
    j.subscribe(U, (change) => live.push(change))
    j.record(
      U,
      fact({ key: 'run:old', topic: 'run.completed', severity: 'success', title: 'Done' }),
    )
    j.record(U, fact({ key: 'condition:old', condition: true }))
    await j.flush()
    clock += INBOX_RETENTION_MS + 1
    expect(await j.prune()).toBe(1)
    const keys = (await j.sync(U, 0)).changes.map((c) => ('entry' in c ? c.entry.key : ''))
    expect(keys).toEqual(['condition:old'])
    expect(live.at(-1)).toMatchObject({ removedKey: 'run:old' })
  })

  it('keeps users apart', async () => {
    const j = await journal()
    j.record('a', fact())
    await j.flush()
    expect((await j.sync('b', 0)).changes).toEqual([])
  })
})
