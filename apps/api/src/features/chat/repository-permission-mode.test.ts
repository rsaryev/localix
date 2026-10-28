import { tmpdir } from 'node:os'
import { routedAgent } from '../../testing/session-fixture'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createChatRepository, type SessionRecord } from './repository'

const tempDir = join(tmpdir(), `localix-chat-repository-permission-mode-tests-${process.pid}`)

function session(id: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  const timestamp = '2026-10-03T00:00:00.000Z'
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
 * A mode is the conversation TREE's. A delegated child reads its own row when it runs, so a root
 * that changed mode while its children kept the old one would leave a worker writing inside a plan
 * conversation — or still refusing questions after the person turned autonomy off.
 */
describe('a session tree shares one permission mode', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('a fresh session is in the default mode', async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('root'))
    expect((await repo.getSession('user-a', 'root'))?.permissionMode).toBe('default')
    await destroyDatabase(db)
  })

  test("changing the root's mode reaches every session of its tree, and no other", async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('root'))
    await repo.insertSession(
      session('child', {
        seq: 2,
        parentSessionId: 'root',
        rootSessionId: 'root',
        sessionKind: 'subagent',
      }),
    )
    await repo.insertSession(session('other', { seq: 3 }))

    await repo.updateSession('user-a', 'root', { permissionMode: 'plan' })

    expect((await repo.getSession('user-a', 'root'))?.permissionMode).toBe('plan')
    expect((await repo.getSession('user-a', 'child'))?.permissionMode).toBe('plan')
    expect((await repo.getSession('user-a', 'other'))?.permissionMode).toBe('default')
    await destroyDatabase(db)
  })

  test('a child inserted with its tree mode keeps it', async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('root', { permissionMode: 'autonomous' }))
    await repo.insertSession(
      session('child', {
        seq: 2,
        parentSessionId: 'root',
        rootSessionId: 'root',
        sessionKind: 'subagent',
        permissionMode: 'autonomous',
      }),
    )
    expect((await repo.getSession('user-a', 'child'))?.permissionMode).toBe('autonomous')
    await destroyDatabase(db)
  })
})
