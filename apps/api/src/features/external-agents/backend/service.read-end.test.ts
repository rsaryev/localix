import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentSessionsService } from './service'

/**
 * `TranscriptSlice.readFrom` is assigned by the SERVICE, because it is the layer that chose the end.
 *
 * Pinned end to end rather than through a fixture that sets the field itself: removing the assignment
 * left every other test in this plugin green, which is the failure mode where a guard never reaches
 * the thing it guards. A real store, the real registry, the real slice assembly.
 */
async function hermesStore(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'read-end-'))
  await mkdir(join(home, '.hermes'), { recursive: true })
  const db = new Database(join(home, '.hermes', 'state.db'))
  db.run(
    `CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, model TEXT,
       parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, message_count INTEGER,
       api_call_count INTEGER, input_tokens INTEGER, output_tokens INTEGER,
       cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, title TEXT)`,
  )
  db.run(
    `CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
       role TEXT NOT NULL, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT,
       timestamp REAL NOT NULL)`,
  )
  db.run(
    `INSERT INTO sessions (id, source, model, started_at, message_count, api_call_count)
     VALUES ('s1', 'cli', 'm', 1781127002, 4, 1)`,
  )
  const insert = db.prepare(
    `INSERT INTO messages (session_id, role, content, timestamp) VALUES ('s1', ?, ?, ?)`,
  )
  for (let i = 0; i < 4; i += 1)
    insert.run(i % 2 === 0 ? 'user' : 'assistant', `turn ${i}`, 1781127002 + i)
  db.close()
  return home
}

async function service(): Promise<AgentSessionsService> {
  const home = await hermesStore()
  return new AgentSessionsService(await mkdtemp(join(tmpdir(), 'read-end-state-')), () => {}, {
    env: {},
    homeDir: home,
  })
}

describe('a slice records which end it was read from', () => {
  test('a tail request is recorded as one', async () => {
    const slice = await (await service()).transcript('hermes:s1', 2, 4000, true)

    expect(slice?.readFrom).toBe('tail')
    // Really the last two turns, not merely labelled so.
    expect(slice?.events.map((event) => event.text)).toEqual(['turn 2', 'turn 3'])
  })

  test('the default is recorded as a head read', async () => {
    const slice = await (await service()).transcript('hermes:s1', 2, 4000)

    expect(slice?.readFrom).toBe('head')
    expect(slice?.events.map((event) => event.text)).toEqual(['turn 0', 'turn 1'])
  })

  test('a whole session still says which end was asked for, and withholds nothing', async () => {
    const slice = await (await service()).transcript('hermes:s1', 50, 4000, true)

    expect(slice?.withheld).toBe(0)
    expect(slice?.sourceTruncated).toBeUndefined()
    expect(slice?.readFrom).toBe('tail')
  })
})
