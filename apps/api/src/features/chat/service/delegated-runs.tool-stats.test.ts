import { afterEach, beforeEach, expect, test } from 'bun:test'

import { DEFAULT_AGENT_AUTHOR } from '../../../db'
import { createDatabase, destroyDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import { routedAgent, sessionFixture } from '../../../testing/session-fixture'
import { createChatRepository } from '../repository'
import { readSessionToolStats } from './delegated-runs'

let db: ReturnType<typeof createDatabase>
beforeEach(async () => {
  db = createDatabase()
  await migrateToLatest(db)
})
afterEach(async () => {
  await destroyDatabase(db)
})

test('a child’s tool calls add up to the counts an Agent result reports', async () => {
  const repo = createChatRepository(db)
  await repo.insertSession(
    sessionFixture({ id: 'child', userId: 'u', agent: routedAgent(), rootSessionId: 'child' }),
  )
  const at = '2026-10-01T00:00:00.000Z'
  await repo.insertMessage({
    id: 'm1',
    sessionId: 'child',
    userId: 'u',
    payload: {
      id: 'm1',
      role: 'assistant',
      from: DEFAULT_AGENT_AUTHOR,
      content: '',
      items: [
        { type: 'tool_call', name: 'Read' },
        { type: 'tool_call', name: 'Read' },
        { type: 'tool_call', name: 'Search' },
        { type: 'command', name: 'Bash' },
        { type: 'tool_call', name: 'Skill' },
        { type: 'file_change', name: 'Edit', changes: [{ diff: '--- a\n+++ b\n+x\n+y\n-z' }] },
      ],
    } as never,
    createdAt: at,
    updatedAt: at,
  })
  expect(await readSessionToolStats(db, 'child')).toEqual({
    readCount: 2,
    searchCount: 1,
    bashCount: 1,
    editFileCount: 1,
    linesAdded: 2,
    linesRemoved: 1,
    otherToolCount: 1,
  })
})
