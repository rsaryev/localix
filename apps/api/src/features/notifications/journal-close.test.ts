import { describe, expect, it } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { RaiseFact } from './contracts'
import { createNotificationJournal } from './journal'

const U = 'local-user'
const fact = (key: string): RaiseFact => ({
  key,
  topic: 'terminal.finished',
  category: 'terminal',
  severity: 'info',
  title: 'Background terminal stopped',
  origin: { kind: 'application', label: 'Terminal' },
})

async function setup(log?: (event: string, detail: Record<string, unknown>) => void) {
  const db = createDatabase()
  await migrateToLatest(db)
  return { db, journal: createNotificationJournal({ db, log }) }
}

describe('closing the notification journal (server shutdown)', () => {
  it('commits what was queued before it resolves', async () => {
    const { db, journal } = await setup()
    journal.record(U, fact('terminal:t1'))
    await journal.close()
    expect((await journal.sync(U, 0)).changes).toHaveLength(1)
    await destroyDatabase(db)
  })

  it('drops facts raised by the teardown and never touches the closed database', async () => {
    const events: string[] = []
    const { db, journal } = await setup((event) => events.push(event))
    await journal.close()
    await destroyDatabase(db)
    // A job or terminal killed by shutdown reports here, after the database is gone.
    journal.record(U, fact('terminal:t2'))
    journal.settle(U, { prefix: 'terminal:', reason: 'cancelled' })
    await expect(journal.apply(U, [{ id: 'op1', op: 'clear' }])).rejects.toThrow('closed')
    await journal.flush()
    expect(events).toEqual([])
  })

  it('a write failure whose logger already threw does not escape the drain', async () => {
    const { db, journal } = await setup(() => {
      throw new Error('SonicBoom destroyed')
    })
    await destroyDatabase(db)
    journal.record(U, fact('terminal:t3'))
    await expect(journal.flush()).resolves.toBeUndefined()
  })
})
