import { tmpdir } from 'node:os'
import { DEFAULT_AGENT_AUTHOR, USER_AUTHOR } from './author'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'

import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { sql } from 'kysely'

import { backupDatabaseBeforeMigration, createDatabase, destroyDatabase } from './connection'
import { migrateToLatest } from './migrator'
import {
  MESSAGE_PAYLOAD_VERSION,
  deserializeMessagePayload,
  serializeMessagePayload,
  type StoredMessagePayload,
} from './payload'

const tempDir = join(tmpdir(), `localix-db-tests-${process.pid}`)

describe('apps/api db layer', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('migrations create the complete schema with valid foreign keys', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })

    await migrateToLatest(db)

    const sqliteTables = await db
      .selectFrom('sqlite_master')
      .select(['name', 'type'])
      .where('type', '=', 'table')
      .execute()

    expect(sqliteTables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'provider_connections',
        'projects',
        'agent_sessions',
        'agent_messages',
        'agent_message_usage',
        'agent_runs',
        'agent_queue_items',
        'agent_delivery_receipts',
        'session_prompt_snapshots',
        'agent_external_session_keys',
        'ref_sequence_counters',
        'user_profiles',
        'usage_events',
        'provider_connection_keys',
        'vault_items',
        'vault_item_versions',
        'vault_aliases',
        'vault_folders',
        'vault_item_bindings',
        'vault_audit',
        'capability_source',
        'skill_usage',
        'triggers',
        'work_records',
        'agent_messages_fts',
        'tool_output_chunks',
        'tool_output_artifacts',
      ]),
    )
    // The task board is a plugin with its own store; a core table for it would be a second owner.
    expect(sqliteTables.map((row) => row.name)).not.toContain('kanban_tasks')
    expect(sqliteTables.map((row) => row.name)).not.toContain('kanban_comments')
    expect(sqliteTables.map((row) => row.name)).not.toContain('provider_usage_snapshot_cache')
    // Removed runtime journals must not return to the canonical schema.
    for (const dropped of [
      'agent_session_entries',
      'agent_run_events',
      'agent_run_checkpoints',
      'agent_compactions',
      // The per-session agent-edit ledger, dropped with the feature it existed for.
      'session_edits',
    ]) {
      expect(sqliteTables.map((row) => row.name)).not.toContain(dropped)
    }
    // `agent_runs` survives, minus the columns that named rows in those tables. The boot sweep
    // (`reclassifyInterruptedRuns`) is its reader.
    const runColumns = await sql<{ name: string }>`PRAGMA table_xinfo(agent_runs)`.execute(db)
    expect(runColumns.rows.map((row) => row.name).sort()).toEqual([
      'adapter',
      'adapter_version',
      'agent_id',
      'credential_id',
      'error_code',
      'error_json',
      'finished_at',
      'id',
      'model_id',
      'provider_id',
      'session_id',
      'started_at',
      'status',
    ])
    const sessionColumns = await sql<{ name: string }>`PRAGMA table_xinfo(agent_sessions)`.execute(
      db,
    )
    const sessionColumnNames = sessionColumns.rows.map((row) => row.name)
    for (const dropped of ['runtime_leaf_entry_id', 'revision', 'next_entry_sequence']) {
      expect(sessionColumnNames).not.toContain(dropped)
    }
    // …while the chat-message branch tip, whose name is one letter away, must still be there.
    expect(sessionColumnNames).toContain('leaf_id')
    // Addressable agent names, and the index that makes a name a RELIABLE address: uniqueness is
    // the whole guarantee (a name resolving to two agents would let a caller brief a stranger), so
    // the index is asserted here rather than trusted to the migration that creates it.
    expect(sessionColumnNames).toContain('task_name')
    // The conversation's one agent and its route are columns of the session.
    for (const column of ['agent_id', 'agent_name', 'model_id', 'model_selected_at']) {
      expect(sessionColumnNames).toContain(column)
    }
    expect(
      await sql<{ sql: string }>`
        SELECT sql FROM sqlite_master
        WHERE type = 'index' AND name = 'agent_sessions_task_name_unique_idx'
      `.execute(db),
    ).toMatchObject({ rows: [{ sql: expect.stringContaining('UNIQUE INDEX') }] })

    // The frozen baseline runs first; every later schema change is its own ledger row after it.
    const migrations = await sql<{ name: string }>`
      SELECT name FROM kysely_migration ORDER BY name
    `.execute(db)
    expect(migrations.rows[0]?.name).toBe('20260601T000000_init_schema')

    expect(
      await db
        .selectFrom('capability_source')
        .select(['id', 'user_id', 'kind', 'project_id', 'name', 'config'])
        .where('id', '=', 'localix-default-mcp-grep')
        .executeTakeFirst(),
    ).toEqual({
      id: 'localix-default-mcp-grep',
      user_id: 'local-user',
      kind: 'mcp',
      project_id: '',
      name: 'grep',
      // Transport and description ride INSIDE the blob: the shared table has no column
      // for either, and no query ever filtered on them.
      config:
        '{"transport":"http","description":"Search public GitHub code with grep.app","url":"https://mcp.grep.app"}',
    })

    const foreignKeyErrors = await sql<unknown>`PRAGMA foreign_key_check`.execute(db)
    expect(foreignKeyErrors.rows).toEqual([])

    await destroyDatabase(db)
  })

  test('seeds default MCP once without replacing user configuration or deletion', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })

    await migrateToLatest(db, { defaultUserId: 'configured-user' })
    expect(
      await db
        .selectFrom('capability_source')
        .select(['user_id', 'name', 'config'])
        .where('name', '=', 'grep')
        .execute(),
    ).toEqual([
      {
        user_id: 'configured-user',
        name: 'grep',
        config:
          '{"transport":"http","description":"Search public GitHub code with grep.app","url":"https://mcp.grep.app"}',
      },
    ])

    // A user's own edit stands: the ledger records the baseline as applied, so a second
    // start does not re-run the seed and cannot overwrite what they configured.
    await db
      .updateTable('capability_source')
      .set({
        config: '{"transport":"http","description":"my grep","url":"https://custom.example/mcp"}',
      })
      .where('user_id', '=', 'configured-user')
      .where('name', '=', 'grep')
      .execute()
    await migrateToLatest(db, { defaultUserId: 'configured-user' })

    expect(
      await db
        .selectFrom('capability_source')
        .select(['config'])
        .where('user_id', '=', 'configured-user')
        .where('name', '=', 'grep')
        .executeTakeFirst(),
    ).toEqual({
      config: '{"transport":"http","description":"my grep","url":"https://custom.example/mcp"}',
    })

    // And a DELETION stays deleted, for the same reason.
    await db
      .deleteFrom('capability_source')
      .where('user_id', '=', 'configured-user')
      .where('name', '=', 'grep')
      .execute()
    await migrateToLatest(db, { defaultUserId: 'configured-user' })

    expect(
      await db
        .selectFrom('capability_source')
        .select('id')
        .where('user_id', '=', 'configured-user')
        .where('name', '=', 'grep')
        .executeTakeFirst(),
    ).toBeUndefined()

    await destroyDatabase(db)
  })

  test('long-session hot queries use their covering or partial indexes', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    const explain = async (query: ReturnType<typeof sql>) =>
      (await query.execute(db)).rows
        .map((row) => {
          const detail = (row as { detail?: unknown }).detail
          return typeof detail === 'string' ? detail : ''
        })
        .join('\n')

    expect(
      await explain(sql`EXPLAIN QUERY PLAN
        SELECT * FROM agent_queue_items ORDER BY priority, sequence`),
    ).toContain('agent_queue_items_priority_sequence_idx')

    expect(
      await explain(sql`EXPLAIN QUERY PLAN
        UPDATE agent_queue_items
        SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL
        WHERE state = 'leased' AND lease_expires_at <= '2026-07-22 00:00:00'`),
    ).toContain('agent_queue_items_leased_expiry_idx')

    expect(
      await explain(sql`EXPLAIN QUERY PLAN
        SELECT message_id FROM usage_events
        WHERE user_id = 'u'
        ORDER BY created_at DESC, message_id DESC LIMIT 51`),
    ).toContain('usage_events_user_created_message_idx')

    expect(
      await explain(sql`EXPLAIN QUERY PLAN
        SELECT message.id, message.payload_json
        FROM agent_messages AS message
        INNER JOIN agent_sessions AS session ON session.id = message.session_id
        LEFT JOIN usage_events AS event ON event.message_id = message.id
        WHERE message.role = 'assistant'
          AND CASE WHEN json_valid(message.payload_json)
            THEN json_type(message.payload_json, '$.usage') ELSE NULL END = 'object'
          AND event.message_id IS NULL`),
    ).toContain('agent_messages_assistant_reconcile_idx')

    expect(
      await explain(sql`EXPLAIN QUERY PLAN
        SELECT session_id, count(*) FROM agent_messages
        WHERE user_id = 'u' GROUP BY session_id`),
    ).toContain('agent_messages_user_session_idx')

    await destroyDatabase(db)
  })

  test('payload_json round-trips the existing agent chat payload shape', () => {
    const payload: StoredMessagePayload = {
      id: 'msg_1',
      role: 'assistant',
      from: DEFAULT_AGENT_AUTHOR,
      content: 'hello',
      reasoning: 'thinking',
      items: [
        {
          id: 'text-0',
          type: 'text',
          status: 'completed',
          turnIndex: 0,
          contentIndex: 0,
          text: 'hello',
          textSignature: 'text-sig',
          api: 'google-generative-ai',
          provider: 'google',
          model: 'gemini-3',
        },
        {
          id: 'tool_1',
          type: 'tool_call',
          status: 'completed',
          toolCallId: 'tool_1',
          name: 'Search',
          activeVerb: 'Searching',
          input: { q: 'hi' },
          output: { ok: true },
          turnIndex: 0,
          contentIndex: 1,
          thoughtSignature: 'tool-sig',
          api: 'google-generative-ai',
          provider: 'google',
          model: 'gemini-3',
        },
        {
          id: 'reasoning-0',
          type: 'reasoning',
          status: 'completed',
          turnIndex: 0,
          contentIndex: 2,
          text: '',
          thinkingSignature: 'thinking-sig',
          redacted: true,
          api: 'google-generative-ai',
          provider: 'google',
          model: 'gemini-3',
        },
      ],
      // No `branches`/`branchIndex` here: branching is TREE-NATIVE (siblings are
      // separate message rows — see chat/service/branching-ops.ts `repo.siblings`).
      // The payload never carried them; the old fixture round-tripped a shape that
      // no stored message can have.
    }

    // Plus the stamp the codec adds: it describes the stored form (see MESSAGE_PAYLOAD_VERSION).
    expect(deserializeMessagePayload(serializeMessagePayload(payload))).toEqual({
      ...payload,
      v: MESSAGE_PAYLOAD_VERSION,
    })
  })

  test('pre-migration snapshots include committed WAL data', async () => {
    const filename = join(tempDir, `${randomUUID()}.sqlite`)
    const db = createDatabase({ filename })
    await migrateToLatest(db)
    await sql`INSERT INTO user_profiles (user_id, agent_settings) VALUES ('snapshot-user', 'Snapshot')`.execute(
      db,
    )

    const backup = await backupDatabaseBeforeMigration(db)
    expect(backup).toBeString()
    const snapshot = new Database(backup!, { strict: true })
    try {
      expect(
        snapshot
          .query<{ agent_settings: string }, []>(
            "SELECT agent_settings FROM user_profiles WHERE user_id = 'snapshot-user'",
          )
          .get()?.agent_settings,
      ).toBe('Snapshot')
    } finally {
      snapshot.close()
      await destroyDatabase(db)
    }
  })

  test('messages persist with session foreign keys and sequence ordering', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    await db
      .insertInto('provider_connections')
      .values({
        id: 'pc_1',
        user_id: 'user_1',
        provider_id: 'openrouter',
        provider_name: 'OpenRouter',
        label: 'Primary',
        auth_type: 'api-key',
        status: 'active',
      })
      .execute()

    await db
      .insertInto('agent_sessions')
      .values({
        project_id: 'PRJ-test',
        id: 'sess_1',
        user_id: 'user_1',
        title: 'Test session',
        // The route columns are optional: this row does not need an agent to exist.
      })
      .execute()

    await db
      .insertInto('agent_messages')
      .values({
        id: 'msg_1',
        session_id: 'sess_1',
        user_id: 'user_1',
        sequence: 1,
        role: 'user',
        payload_json: serializeMessagePayload({
          id: 'msg_1',
          role: 'user',
          from: USER_AUTHOR,
          content: 'Persist me',
        }),
      })
      .execute()

    const row = await db
      .selectFrom('agent_messages')
      .selectAll()
      .where('id', '=', 'msg_1')
      .executeTakeFirstOrThrow()

    expect(row.sequence).toBe(1)
    expect(row.role).toBe('user')
    expect(deserializeMessagePayload(row.payload_json)).toEqual({
      id: 'msg_1',
      role: 'user',
      from: USER_AUTHOR,
      content: 'Persist me',
      v: MESSAGE_PAYLOAD_VERSION,
    })

    expect(
      db
        .insertInto('agent_messages')
        .values({
          id: 'msg_2',
          session_id: 'missing_session',
          user_id: 'user_1',
          sequence: 2,
          role: 'assistant',
          payload_json: serializeMessagePayload({
            id: 'msg_2',
            role: 'assistant',
            from: DEFAULT_AGENT_AUTHOR,
            content: 'should fail',
          }),
        })
        .execute(),
    ).rejects.toThrow()

    await destroyDatabase(db)
  })
})
