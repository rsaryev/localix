/**
 * The migration that takes the task board out of core rewrites stored provenance, so what it
 * changes is pinned here. The provenance parser is strict: a stored delegation that still carries
 * `kanbanTaskId` is refused as written by a bug, which would make every session a board ever
 * delegated unreadable after the upgrade. So the migrated rows must parse, the key must go only
 * from delegations, and the board's table, allocator row and index must go with it.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { sql, type Kysely } from 'kysely'
import type { MigrationProvider } from 'kysely/migration'

import { parseSessionProvenance } from '../features/chat/session-provenance'
import { createDatabase, destroyDatabase } from './connection'
import { shippedMigrations } from './migration-provider'
import { migrateToLatest } from './migrator'
import type { AppDatabase } from './types'

const TARGET = '20260926T000000_kanban_leaves_core'

/** The shipped migrations up to — and, with `withTarget`, including — the one under test. */
const upTo = (withTarget: boolean): MigrationProvider => ({
  getMigrations: async () =>
    Object.fromEntries(
      Object.entries(await shippedMigrations().getMigrations()).filter(([name]) =>
        withTarget ? name <= TARGET : name < TARGET,
      ),
    ),
})

const databases: Kysely<AppDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => destroyDatabase(db)))
})

async function seededBoardDatabase() {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db, { migrations: upTo(false) })
  const session = (id: string, invocation: object) =>
    sql`INSERT INTO agent_sessions (id, project_id, user_id, title, invocation_json)
        VALUES (${id}, 'PRJ-1', 'u', ${id}, ${JSON.stringify(invocation)})`.execute(db)
  await session('parent', { kind: 'root' })
  await session('child', {
    kind: 'task-delegation',
    parentSessionId: 'parent',
    toolCallId: 'call-1',
    parentParticipant: 'agent:builtin:lead',
    kanbanTaskId: 'LX-7',
  })
  await session('loop', { kind: 'loop', parentSessionId: 'parent', loopId: 'l1' })
  // Written the way the board wrote them, so the drop is proven against real rows.
  await sql`INSERT INTO kanban_tasks (id, user_id, scope_session_id, title)
      VALUES ('LX-7', 'u', 'parent', 'Build UI')`.execute(db)
  await sql`UPDATE ref_sequence_counters SET last_value = 7 WHERE scope = 'kanban_tasks'`.execute(
    db,
  )
  return db
}

const schemaObject = async (db: Kysely<AppDatabase>, name: string) =>
  (await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE name = ${name}`.execute(db))
    .rows

describe('the task board leaves core', () => {
  test('the stored rows really did carry the board before it ran', async () => {
    // Positive control: without it, a seed that silently lost the key would pass the test below.
    const db = await seededBoardDatabase()
    const row = await sql<{ invocation_json: string }>`
      SELECT invocation_json FROM agent_sessions WHERE id = 'child'`.execute(db)
    expect(() => parseSessionProvenance(row.rows[0]!.invocation_json)).toThrow(
      'Unrecognized session provenance',
    )
  })

  test('a delegation that carried a card id parses afterwards, with nothing else lost', async () => {
    const db = await seededBoardDatabase()
    await migrateToLatest(db, { migrations: upTo(true) })

    const rows = await sql<{ id: string; invocation_json: string }>`
      SELECT id, invocation_json FROM agent_sessions ORDER BY id`.execute(db)
    const provenance = Object.fromEntries(
      rows.rows.map((row) => [row.id, parseSessionProvenance(row.invocation_json)]),
    )
    expect(provenance).toEqual({
      child: {
        kind: 'task-delegation',
        parentSessionId: 'parent',
        toolCallId: 'call-1',
        parentParticipant: 'agent:builtin:lead',
      },
      loop: { kind: 'loop', parentSessionId: 'parent', loopId: 'l1' },
      parent: { kind: 'root' },
    })
  })

  test("drops the board's table, its allocator row and the card-attempt index", async () => {
    const db = await seededBoardDatabase()
    await migrateToLatest(db, { migrations: upTo(true) })

    expect(await schemaObject(db, 'kanban_tasks')).toEqual([])
    expect(await schemaObject(db, 'agent_sessions_task_attempt_idx')).toEqual([])
    const scopes = await sql<{ scope: string }>`
      SELECT scope FROM ref_sequence_counters ORDER BY scope`.execute(db)
    // The other allocators keep counting: dropping them would re-issue ids already handed out.
    expect(scopes.rows.map((row) => row.scope)).toEqual(['agent_sessions', 'projects'])
    expect((await sql`PRAGMA foreign_key_check`.execute(db)).rows).toEqual([])
  })
})
