import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { DEFAULT_AGENT_AUTHOR, USER_AUTHOR } from '../../db'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { routedAgent, sessionFixture } from '../../testing/session-fixture'
import type { PersistedMessage } from './contracts'
import { createChatRepository } from './repository'

/**
 * A fork reads its parent's line without copying it: the parent's rows from the root up to the
 * base the call named, then its own. The rows stay the parent's, so what the model reads of them
 * (and the context stored under their ids) is the parent's, byte for byte, however long the
 * parent goes on writing.
 */
let db: ReturnType<typeof createDatabase>
let repo: ReturnType<typeof createChatRepository>

beforeEach(async () => {
  db = createDatabase()
  await migrateToLatest(db)
  repo = createChatRepository(db)
})
afterEach(async () => {
  await destroyDatabase(db)
})

const AT = '2026-07-31T00:00:00.000Z'
const row = (id: string, sessionId: string, role: 'user' | 'assistant', content: string) => ({
  id,
  sessionId,
  userId: 'u',
  payload: {
    id,
    role,
    from: role === 'user' ? USER_AUTHOR : DEFAULT_AGENT_AUTHOR,
    content,
  },
  createdAt: AT,
  updatedAt: AT,
})

async function parentWith(ids: Array<[string, 'user' | 'assistant']>) {
  await repo.insertSession(
    sessionFixture({
      id: 'parent',
      userId: 'u',
      agent: routedAgent(),
      rootSessionId: 'parent',
    }),
  )
  for (const [id, role] of ids) await repo.insertMessage(row(id, 'parent', role, id))
}

async function forkOf(base: string | null) {
  await repo.insertSession(
    sessionFixture({
      id: 'fork',
      userId: 'u',
      seq: 2,
      sessionKind: 'subagent',
      parentSessionId: 'parent',
      rootSessionId: 'parent',
      agent: routedAgent(),
      provenance: {
        kind: 'task-delegation',
        parentSessionId: 'parent',
        toolCallId: 'call-1',
        fork: { baseMessageId: base, snapshotMessageId: 'copy' },
      },
    }),
  )
  await repo.insertMessage(row('copy', 'fork', 'assistant', 'the parent’s row at the call'))
  await repo.insertMessage(row('directive', 'fork', 'user', 'do the thing'))
}

const ids = (rows: PersistedMessage[]) => rows.map((message) => message.id)

describe('a fork’s history', () => {
  test('is the parent’s line up to the base, then its own rows', async () => {
    await parentWith([
      ['u1', 'user'],
      ['a1', 'assistant'],
      ['u2', 'user'],
      ['a2', 'assistant'],
    ])
    await forkOf('u2')
    const history = await repo.listMessages('u', 'fork')
    expect(ids(history)).toEqual(['u1', 'a1', 'u2', 'copy', 'directive'])
    // The inherited rows are still the parent's: nothing was copied.
    expect(history.map((message) => message.sessionId)).toEqual([
      'parent',
      'parent',
      'parent',
      'fork',
      'fork',
    ])
  })

  test('does not move when the parent goes on writing, regenerates or branches', async () => {
    await parentWith([
      ['u1', 'user'],
      ['a1', 'assistant'],
      ['u2', 'user'],
      ['a2', 'assistant'],
    ])
    await forkOf('u2')
    const before = await repo.listMessages('u', 'fork')

    await repo.insertMessage(row('u3', 'parent', 'user', 'a later turn'))
    await repo.insertMessage(row('a3', 'parent', 'assistant', 'and its reply'))
    // A regenerated answer to u2: the parent's active branch now leaves a2 behind.
    await repo.setSessionLeaf('parent', 'u2')
    await repo.insertMessage(row('a2-again', 'parent', 'assistant', 'another answer'))

    expect(ids(await repo.listMessages('u', 'parent'))).toEqual(['u1', 'a1', 'u2', 'a2-again'])
    expect(await repo.listMessages('u', 'fork')).toEqual(before)
  })

  test('a fork of the first turn has no inherited rows, and a vanished base leaves its own', async () => {
    await parentWith([['u1', 'user']])
    await forkOf(null)
    expect(ids(await repo.listMessages('u', 'fork'))).toEqual(['copy', 'directive'])

    await destroyDatabase(db)
    db = createDatabase()
    await migrateToLatest(db)
    repo = createChatRepository(db)
    await parentWith([['u1', 'user']])
    await forkOf('gone')
    expect(ids(await repo.listMessages('u', 'fork'))).toEqual(['copy', 'directive'])
  })

  test('a session without a fork reads only its own rows', async () => {
    await parentWith([
      ['u1', 'user'],
      ['a1', 'assistant'],
    ])
    expect(ids(await repo.listMessages('u', 'parent'))).toEqual(['u1', 'a1'])
  })
})
