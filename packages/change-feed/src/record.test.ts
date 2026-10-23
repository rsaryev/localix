import { afterEach, describe, expect, test } from 'bun:test'
import { onRecorded, recordChanges, setChangeLog } from './record'
import { createTestDatabase } from './testing'

type Note = { entity: 'note'; op: 'upserted' | 'deleted'; ref: { id: string } }
const note = (id: string, op: Note['op'] = 'upserted'): Note => ({
  entity: 'note',
  op,
  ref: { id },
})

const rows = async (db: Awaited<ReturnType<typeof createTestDatabase>>) =>
  db.selectFrom('change_events').select(['stream', 'entity', 'op', 'ref_json']).execute()

afterEach(() => setChangeLog(undefined))

describe('recordChanges', () => {
  test('writes one row per change, with the ref as JSON and no ref for a resync', async () => {
    const db = await createTestDatabase()
    await recordChanges(db, 'core', [note('n1'), { entity: 'note', op: 'resync' }])
    expect(await rows(db)).toEqual([
      { stream: 'core', entity: 'note', op: 'upserted', ref_json: '{"id":"n1"}' },
      { stream: 'core', entity: 'note', op: 'resync', ref_json: null },
    ])
  })

  test('a notice exists exactly when its transaction commits', async () => {
    const db = await createTestDatabase()
    await db
      .transaction()
      .execute(async (trx) => {
        await recordChanges(trx, 'core', note('rolled-back'))
        throw new Error('the owner write failed')
      })
      .catch(() => {})
    expect(await rows(db)).toEqual([])
    await db.transaction().execute((trx) => recordChanges(trx, 'core', note('kept')))
    expect((await rows(db)).map((row) => row.ref_json)).toEqual(['{"id":"kept"}'])
  })

  test('an empty list writes nothing and wakes nobody', async () => {
    const db = await createTestDatabase()
    let woken = 0
    const off = onRecorded('core', () => void (woken += 1))
    await recordChanges(db, 'core', [])
    await Promise.resolve()
    expect(await rows(db)).toEqual([])
    expect(woken).toBe(0)
    off()
  })

  test('never throws into the producer: the failure is logged and the write stands', async () => {
    const db = await createTestDatabase()
    const logged: string[] = []
    setChangeLog((event) => logged.push(event))
    await db.schema.dropTable('change_events').execute()
    await db.schema.createTable('owner').addColumn('id', 'text').execute()
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('owner' as never)
        .values({ id: 'kept' } as never)
        .execute()
      await recordChanges(trx, 'core', note('lost'))
    })
    expect(logged).toEqual(['changes.record_failed'])
    expect(
      await db
        .selectFrom('owner' as never)
        .selectAll()
        .execute(),
    ).toEqual([{ id: 'kept' }])
  })

  test('a failing log sink does not break the producer either', async () => {
    const db = await createTestDatabase()
    setChangeLog(() => {
      throw new Error('sink closed')
    })
    await db.schema.dropTable('change_events').execute()
    expect(await recordChanges(db, 'core', note('n1'))).toBeUndefined()
  })

  test('wakes the listeners of its own stream after the write, and only those', async () => {
    const db = await createTestDatabase()
    const woken: string[] = []
    const seenAtSignal: number[] = []
    const offCore = onRecorded('core', () => {
      woken.push('core')
      void rows(db).then((list) => seenAtSignal.push(list.length))
    })
    const offMiniApp = onRecorded('mini-app:x', () => woken.push('mini-app'))
    await recordChanges(db, 'core', note('n1'))
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(woken).toEqual(['core'])
    expect(seenAtSignal).toEqual([1])
    offCore()
    offMiniApp()
  })

  test('a throwing listener neither fails the producer nor silences the others', async () => {
    const db = await createTestDatabase()
    let reached = false
    const offBad = onRecorded('core', () => {
      throw new Error('listener broke')
    })
    const offGood = onRecorded('core', () => void (reached = true))
    await recordChanges(db, 'core', note('n1'))
    await Promise.resolve()
    expect(reached).toBe(true)
    offBad()
    offGood()
  })

  test('an unsubscribed listener is not woken again', async () => {
    const db = await createTestDatabase()
    let woken = 0
    const off = onRecorded('core', () => void (woken += 1))
    off()
    await recordChanges(db, 'core', note('n1'))
    await Promise.resolve()
    expect(woken).toBe(0)
  })
})
