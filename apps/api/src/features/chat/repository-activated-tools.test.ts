import { tmpdir } from 'node:os'
import { routedAgent } from '../../testing/session-fixture'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createChatRepository, type SessionRecord } from './repository'

const tempDir = join(tmpdir(), `localix-chat-repository-activated-tools-tests-${process.pid}`)

function session(id: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  const timestamp = '2026-08-18T00:00:00.000Z'
  return {
    id,
    userId: 'user-a',
    seq: 1,
    title: id,
    isPinned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessageAt: timestamp,
    executionBackend: 'local',
    executionTarget: null,
    projectId: 'PRJ-test',
    parentSessionId: null,
    rootSessionId: id,
    sessionKind: 'chat',
    agent: routedAgent(),
    description: null,
    runtimeStatus: 'idle',
    sourceToolCallId: null,
    provenance: { kind: 'root' },
    pinnedSkills: [],
    activatedTools: [],
    archivedAt: null,
    ...overrides,
  }
}

async function freshRepo() {
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  return { db, repo: createChatRepository(db) }
}

/**
 * Activation is a decision the MODEL makes once and the session keeps. It is persisted rather than held
 * in process memory because a session outlives the process: a restart, a `--watch` reload, a child
 * session resumed an hour later. Without it the model pays a full turn to re-activate a tool it already
 * used — which is exactly what a live session did, twice, two minutes apart.
 */
describe('a session remembers the tools it activated', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('a fresh session has activated nothing', async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('s1'))

    expect((await repo.getSession('user-a', 's1'))?.activatedTools).toEqual([])

    await destroyDatabase(db)
  })

  test('an activation survives the write and keeps its order', async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('s1'))

    await repo.updateSession('user-a', 's1', {
      activatedTools: ['catalog_query', 'github_create_issue'],
    })

    expect((await repo.getSession('user-a', 's1'))?.activatedTools).toEqual([
      'catalog_query',
      'github_create_issue',
    ])

    await destroyDatabase(db)
  })

  test('an inserted set is stored as given', async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('s1', { activatedTools: ['catalog_query'] }))

    expect((await repo.getSession('user-a', 's1'))?.activatedTools).toEqual(['catalog_query'])

    await destroyDatabase(db)
  })

  test("a change is computed from the STORED set, so a second writer keeps the first one's names", async () => {
    // A run writes what it read at its start; a wake activates tools in between. Only a change
    // applied to what is stored keeps both.
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('s1', { activatedTools: ['catalog_query'] }))
    const add = (name: string) => (stored: string[]) =>
      stored.includes(name) ? null : { next: [...stored, name] }

    await repo.changeActivatedTools('user-a', 's1', add('board_game_move'))
    const second = await repo.changeActivatedTools('user-a', 's1', add('github_create_issue'))

    expect(second?.next).toEqual(['catalog_query', 'board_game_move', 'github_create_issue'])
    expect((await repo.getSession('user-a', 's1'))?.activatedTools).toEqual(second!.next)
    // Nothing to write answers null and writes nothing.
    expect(await repo.changeActivatedTools('user-a', 's1', add('catalog_query'))).toBeNull()

    await destroyDatabase(db)
  })

  test("another user's session is neither read nor changed", async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('s1', { activatedTools: ['catalog_query'] }))
    let called = false

    const result = await repo.changeActivatedTools('user-b', 's1', (stored) => {
      called = true
      return { next: [...stored, 'intruder'] }
    })

    expect(result).toBeNull()
    expect(called).toBe(false)
    expect((await repo.getSession('user-a', 's1'))?.activatedTools).toEqual(['catalog_query'])

    await destroyDatabase(db)
  })

  test('clearing the set is a real update, not a no-op', async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('s1', { activatedTools: ['catalog_query'] }))

    await repo.updateSession('user-a', 's1', { activatedTools: [] })

    expect((await repo.getSession('user-a', 's1'))?.activatedTools).toEqual([])

    await destroyDatabase(db)
  })
})
