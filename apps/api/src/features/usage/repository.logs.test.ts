import { expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createUsageRepository } from './repository'

test('log cursors disambiguate equal timestamps without repeating or skipping a row', async () => {
  const db = createDatabase()
  try {
    await migrateToLatest(db)
    const repository = createUsageRepository(db)
    for (const messageId of ['a', 'c', 'b']) {
      await repository.recordEvent({
        messageId,
        sessionId: 'session',
        userId: 'user',
        modelId: 'provider/model',
        createdAt: '2026-01-01 12:00:00',
        totalTokens: 1,
      })
    }
    const first = await repository.queryLogs({ userId: 'user', limit: 1, to: '2026-01-01' })
    expect(first.rows.map((row) => row.messageId)).toEqual(['c'])
    expect(first.nextCursor).not.toBeNull()
    const second = await repository.queryLogs({
      userId: 'user',
      limit: 1,
      cursor: first.nextCursor,
    })
    expect(second.rows.map((row) => row.messageId)).toEqual(['b'])
    expect(second.nextCursor).not.toBeNull()
    const third = await repository.queryLogs({
      userId: 'user',
      limit: 1,
      cursor: second.nextCursor,
    })
    expect(third.rows.map((row) => row.messageId)).toEqual(['a'])
    expect(third.nextCursor).toBeNull()
    expect(await repository.queryLogs({ userId: 'other', limit: 1 })).toEqual({
      rows: [],
      nextCursor: null,
    })
  } finally {
    await destroyDatabase(db)
  }
})
