import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { AGENT_TASK_ROOT_PATH, resolveAgentTaskReference } from '../agent-core/agent-task-name'
import { createChatRepository, type SessionRecord } from './repository'
import { routedAgent, sessionFixture } from '../../testing/session-fixture'

const tempDir = join(tmpdir(), `localix-chat-repository-task-name-tests-${process.pid}`)

/**
 * A minimal session literal. `taskName` is deliberately NOT set anywhere in this file: it is
 * repository-assigned (like `seq`), and every assertion below reads it back from the store — a test
 * that supplied it would be testing itself.
 */
function session(
  id: string,
  seq: number,
  parentSessionId: string | null,
  overrides: Partial<SessionRecord> = {},
): SessionRecord {
  const timestamp = '2026-08-01T00:00:00.000Z'
  return sessionFixture({
    id,
    userId: 'user-a',
    seq,
    title: id,
    agent: routedAgent({ modelId: '', reasoningEffort: 'low' }),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessageAt: timestamp,
    parentSessionId,
    rootSessionId: parentSessionId ? 'root' : id,
    sessionKind: parentSessionId ? 'subagent' : 'chat',
    provenance: parentSessionId
      ? {
          kind: 'task-delegation',
          parentSessionId,
          toolCallId: `delegate-${id}`,
        }
      : { kind: 'root' },
    ...overrides,
  })
}

async function freshRepo() {
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  return { db, repo: createChatRepository(db) }
}

const nameOf = async (repo: ReturnType<typeof createChatRepository>, id: string) =>
  (await repo.getSession('user-a', id))?.taskName

describe('addressable agent names', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('a tree root is /root; a child is named from its title under the parent path', async () => {
    const { db, repo } = await freshRepo()

    await repo.insertSession(session('root', 1, null))
    await repo.insertSession(session('child', 2, 'root', { title: 'Audit the auth flow' }))
    await repo.insertSession(
      session('grandchild', 3, 'child', { title: 'Probe lint', parentSessionId: 'child' }),
    )

    expect(await nameOf(repo, 'root')).toBe(AGENT_TASK_ROOT_PATH)
    expect(await nameOf(repo, 'child')).toBe('/root/audit_the_auth_flow')
    expect(await nameOf(repo, 'grandchild')).toBe('/root/audit_the_auth_flow/probe_lint')

    await destroyDatabase(db)
  })

  test('siblings with the SAME description get suffixed names, never the same address', async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('root', 1, null))
    for (const [n, id] of ['a', 'b', 'c'].entries()) {
      await repo.insertSession(session(id, n + 2, 'root', { title: 'Audit auth' }))
    }

    expect([await nameOf(repo, 'a'), await nameOf(repo, 'b'), await nameOf(repo, 'c')]).toEqual([
      '/root/audit_auth',
      '/root/audit_auth_2',
      '/root/audit_auth_3',
    ])

    await destroyDatabase(db)
  })

  test('the same name in a DIFFERENT tree is a different agent, not a collision', async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('root-1', 1, null))
    await repo.insertSession(session('root-2', 2, null))
    await repo.insertSession(
      session('a', 3, 'root-1', { title: 'Audit auth', rootSessionId: 'root-1' }),
    )
    await repo.insertSession(
      session('b', 4, 'root-2', { title: 'Audit auth', rootSessionId: 'root-2' }),
    )

    expect(await nameOf(repo, 'a')).toBe('/root/audit_auth')
    expect(await nameOf(repo, 'b')).toBe('/root/audit_auth')
    // …and each resolves inside its OWN tree only.
    expect(await repo.findSessionIdByTaskName('user-a', 'root-1', '/root/audit_auth')).toBe('a')
    expect(await repo.findSessionIdByTaskName('user-a', 'root-2', '/root/audit_auth')).toBe('b')

    await destroyDatabase(db)
  })

  test('the database refuses two rows with one name in one tree', async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('root', 1, null))
    await repo.insertSession(session('a', 2, 'root', { title: 'Audit auth' }))

    // Bypassing the claim (a direct write) must still be impossible: uniqueness is the property
    // that makes a name a reliable address, so the index — not the derivation — is its authority.
    expect(
      sql`UPDATE agent_sessions SET task_name = '/root/audit_auth' WHERE id = 'root'`.execute(db),
    ).rejects.toThrow()

    await destroyDatabase(db)
  })

  test('a title change does NOT rename the agent — a name is an address', async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('root', 1, null))
    await repo.insertSession(session('a', 2, 'root', { title: 'Audit auth' }))
    const before = await repo.getSession('user-a', 'a')

    await repo.updateSession('user-a', 'a', { ...before!, title: 'Something else entirely' })

    expect((await repo.getSession('user-a', 'a'))?.title).toBe('Something else entirely')
    expect(await nameOf(repo, 'a')).toBe('/root/audit_auth')

    await destroyDatabase(db)
  })

  test('resolution is name → session id, scoped to the tree AND the owner', async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('root', 1, null))
    await repo.insertSession(session('a', 2, 'root', { title: 'Audit auth' }))

    expect(await repo.findSessionIdByTaskName('user-a', 'root', '/root/audit_auth')).toBe('a')
    // No near-miss matching: an unknown name resolves to nothing rather than to something similar.
    expect(await repo.findSessionIdByTaskName('user-a', 'root', '/root/audit')).toBeNull()
    expect(await repo.findSessionIdByTaskName('user-a', 'root', '/root/audit_auth_2')).toBeNull()
    // Another user's tree is unreachable even with the exact name and the exact root id.
    expect(await repo.findSessionIdByTaskName('user-b', 'root', '/root/audit_auth')).toBeNull()

    await destroyDatabase(db)
  })

  test('a relative reference from a caller resolves to that caller’s own child', async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('root', 1, null))
    await repo.insertSession(session('one', 2, 'root', { title: 'task one' }))
    await repo.insertSession(session('two', 3, 'root', { title: 'task two' }))
    await repo.insertSession(session('worker-of-one', 4, 'one', { title: 'worker' }))

    const from = async (callerId: string, reference: string) => {
      const caller = await repo.getSession('user-a', callerId)
      const resolved = resolveAgentTaskReference(caller?.taskName ?? '', reference)
      if (!resolved.ok) return resolved.reason
      return repo.findSessionIdByTaskName('user-a', 'root', resolved.path)
    }

    expect(await from('one', 'worker')).toBe('worker-of-one')
    // The sibling branch has no `worker`: relative addressing cannot cross into task one's.
    expect(await from('two', 'worker')).toBeNull()
    // …only the canonical name reaches it from there.
    expect(await from('two', '/root/task_one/worker')).toBe('worker-of-one')

    await destroyDatabase(db)
  })

  test('listing a tree filters by canonical path prefix, segment-aligned', async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('root', 1, null))
    await repo.insertSession(session('audit', 2, 'root', { title: 'audit' }))
    await repo.insertSession(session('audit-repo', 3, 'root', { title: 'audit repo' }))
    await repo.insertSession(
      session('probe', 4, 'audit', { title: 'probe', runtimeStatus: 'running' }),
    )

    expect((await repo.listTreeAgentNames('user-a', 'root')).map((row) => row.taskName)).toEqual([
      '/root',
      '/root/audit',
      '/root/audit/probe',
      '/root/audit_repo',
    ])
    // `/root/audit_repo` must NOT appear under the `/root/audit` prefix — the underscore is an
    // ordinary character here, and a LIKE/startsWith filter would have included it.
    expect(
      (await repo.listTreeAgentNames('user-a', 'root', '/root/audit')).map((row) => row.taskName),
    ).toEqual(['/root/audit', '/root/audit/probe'])
    expect(await repo.listTreeAgentNames('user-a', 'root', '/root/audit/probe')).toEqual([
      {
        sessionId: 'probe',
        taskName: '/root/audit/probe',
        runtimeStatus: 'running',
        sessionKind: 'subagent',
      },
    ])
    // The root prefix is the whole tree, and another user's tree is never listed.
    expect(await repo.listTreeAgentNames('user-a', 'root', AGENT_TASK_ROOT_PATH)).toHaveLength(4)
    expect(await repo.listTreeAgentNames('user-b', 'root')).toEqual([])

    await destroyDatabase(db)
  })

  test('a child of an UNNAMED parent is still addressable under the tree root', async () => {
    const { db, repo } = await freshRepo()
    await repo.insertSession(session('root', 1, null))
    // Model a session that predates the column: the migration only names tree roots, so a historic
    // descendant carries NULL. Its own children must not become unaddressable because of that.
    await repo.insertSession(session('legacy', 2, 'root', { title: 'legacy' }))
    await sql`UPDATE agent_sessions SET task_name = NULL WHERE id = 'legacy'`.execute(db)
    await repo.insertSession(session('fresh', 3, 'legacy', { title: 'fresh work' }))

    expect(await nameOf(repo, 'legacy')).toBeNull()
    expect(await nameOf(repo, 'fresh')).toBe('/root/fresh_work')
    // The unnamed row is absent from the roster rather than listed with an empty address.
    expect((await repo.listTreeAgentNames('user-a', 'root')).map((row) => row.sessionId)).toEqual([
      'root',
      'fresh',
    ])

    await destroyDatabase(db)
  })
})
