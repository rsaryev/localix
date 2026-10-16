import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { opencodeAdapter } from './opencode'
import type { AdapterEnv } from './types'

/**
 * A message's PARTS are its turn broken into what actually happened.
 *
 * The reader used to join every part's `.text` into one blob per message, which dropped tool parts
 * entirely: they carry no `.text`, only `tool`, `callID` and a `state` holding the input and the
 * output. In a real local history that is 868 of 3000 sampled parts — the majority of the session, and all
 * of the work.
 */
async function fixture(): Promise<AdapterEnv> {
  const dir = await mkdtemp(join(tmpdir(), 'opencode-db-'))
  const path = join(dir, 'opencode.db')
  const db = new Database(path)
  db.run(
    'create table session (id text primary key, parent_id text, directory text, title text, time_created integer, time_updated integer, data text)',
  )
  db.run(
    'create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text)',
  )
  db.run(
    'create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text)',
  )
  db.run(
    // opencode names a session lazily; an unnamed one carries its own placeholder.
    "insert into session values ('ses_1', null, '/work/app', 'New session - 2026-05-09T22:18:16.731Z', 1000, 2000, ?)",
    [JSON.stringify({})],
  )
  db.run("insert into message values ('m0', 'ses_1', 900, 900, ?)", [
    JSON.stringify({ role: 'user' }),
  ])
  db.run("insert into message values ('m1', 'ses_1', 1000, 1000, ?)", [
    JSON.stringify({ role: 'user' }),
  ])
  db.run("insert into message values ('m2', 'ses_1', 1100, 1100, ?)", [
    JSON.stringify({
      role: 'assistant',
      modelID: 'gpt-5.4',
      tokens: {
        input: 20,
        output: 5,
        reasoning: 2,
        total: 65,
        cache: { read: 40, write: 0 },
      },
    }),
  ])
  // Injected context that opens the session and looks exactly like a user turn.
  db.run("insert into part values ('p0', 'm0', 'ses_1', 900, 900, ?)", [
    JSON.stringify({
      type: 'text',
      text: '<system-reminder>Note: the user opened a file</system-reminder>',
    }),
  ])
  db.run("insert into part values ('p1', 'm1', 'ses_1', 1000, 1000, ?)", [
    JSON.stringify({ type: 'text', text: 'fix the parser' }),
  ])
  db.run("insert into part values ('p2', 'm2', 'ses_1', 1100, 1100, ?)", [
    JSON.stringify({ type: 'reasoning', text: 'thinking about it' }),
  ])
  db.run("insert into part values ('p3', 'm2', 'ses_1', 1110, 1110, ?)", [
    JSON.stringify({
      type: 'tool',
      tool: 'edit',
      callID: 'call_a',
      state: {
        status: 'completed',
        input: { filePath: '/work/app/x.ts' },
        output: 'Edit applied.',
      },
    }),
  ])
  // Turn bookkeeping — nothing anyone said or did.
  db.run("insert into part values ('p4', 'm2', 'ses_1', 1120, 1120, ?)", [
    JSON.stringify({ type: 'step-finish' }),
  ])
  db.run("insert into part values ('p5', 'm2', 'ses_1', 1130, 1130, ?)", [
    JSON.stringify({ type: 'text', text: 'done' }),
  ])
  db.close()
  return { env: { OPENCODE_DB: path }, homeDir: dir }
}

describe('opencode session as a conversation', () => {
  test('a tool part becomes a call and its output, not nothing', async () => {
    const env = await fixture()
    const refs = await opencodeAdapter.listSources(env)
    const result = await opencodeAdapter.readTranscript(
      { ref: refs[0]!, maxEvents: 100, maxCharsPerEvent: 1_000 },
      env,
    )

    const call = result.events.find((event) => event.toolName)
    expect(call?.toolName).toBe('edit')
    expect(call?.toolCallId).toBe('call_a')
    expect(call?.toolInput).toEqual({ filePath: '/work/app/x.ts' })

    const output = result.events.find((event) => event.role === 'tool')
    expect(output?.text).toBe('Edit applied.')
    // Paired by id, so a result cannot be attributed to the call above it.
    expect(output?.toolCallId).toBe('call_a')
  })

  test('parts stay separate instead of collapsing into one blob per message', async () => {
    const env = await fixture()
    const refs = await opencodeAdapter.listSources(env)
    const result = await opencodeAdapter.readTranscript(
      { ref: refs[0]!, maxEvents: 100, maxCharsPerEvent: 1_000 },
      env,
    )
    // injected preamble · user text · reasoning · tool call · tool output · assistant text.
    // The preamble is skipped only when TITLING; it is still part of the conversation.
    expect(result.events.map((event) => event.role)).toEqual([
      'user',
      'user',
      'system',
      'assistant',
      'tool',
      'assistant',
    ])
  })

  test('turn bookkeeping is not a turn', async () => {
    const env = await fixture()
    const refs = await opencodeAdapter.listSources(env)
    const result = await opencodeAdapter.readTranscript(
      { ref: refs[0]!, maxEvents: 100, maxCharsPerEvent: 1_000 },
      env,
    )
    expect(result.events.some((event) => event.text.includes('step-finish'))).toBe(false)
  })
})

describe('opencode session titles', () => {
  test('a placeholder title is replaced by what the user actually typed', async () => {
    // A list of "New session - 2026-05-09T22:18:16.731Z" is a list of timestamps.
    const env = await fixture()
    const refs = await opencodeAdapter.listSources(env)
    const [summary] = await opencodeAdapter.readSummaries(refs, env)
    expect(summary?.title).toBe('fix the parser')
  })

  test('injected context is not mistaken for the first thing said', async () => {
    // The opening turn is often a harness preamble that looks exactly like a user message; titling
    // a session after it names the harness instead of the work.
    const env = await fixture()
    const refs = await opencodeAdapter.listSources(env)
    const [summary] = await opencodeAdapter.readSummaries(refs, env)
    expect(summary?.title).not.toContain('system-reminder')
  })

  test('SQLite summary aggregates measured usage without reading transcript parts', async () => {
    const env = await fixture()
    const refs = await opencodeAdapter.listSources(env)
    const [summary] = await opencodeAdapter.readSummaries(refs, env)

    expect(summary?.messageCount).toBe(3)
    expect(summary?.usage).toMatchObject({
      inputTokens: 20,
      cachedInputTokens: 40,
      outputTokens: 7,
      reasoningTokens: 2,
      totalTokens: 65,
      requests: 1,
    })
    expect(summary?.usage?.byModel[0]?.model).toBe('gpt-5.4')
  })
})

describe('opencode says whether a turn is running, from its newest message row', () => {
  /**
   * Measured on a real local history's database: the newest message of each session is an `assistant` row
   * with `time.completed` set in 5 sessions and an open one in 3. No append-only log exists here,
   * and the JSON tree beside the database is no help — its newest file BY NAME is the newest by
   * mtime in only 3 of 11 sessions, so answering from it would mean stat-ing every message of a
   * session (173 files in the largest here) to sort them.
   */
  async function withNewest(message: Record<string, unknown>, createdMs: number) {
    const env = await fixture()
    const db = new Database(env.env.OPENCODE_DB as string)
    db.run("insert into message values ('m9', 'ses_1', ?, ?, ?)", [
      createdMs,
      createdMs,
      JSON.stringify(message),
    ])
    db.close()
    const ref = (await opencodeAdapter.listSources(env)).find((r) => r.nativeSessionId === 'ses_1')
    return { env, ref: ref! }
  }

  test('a completed assistant message is the turn handed back', async () => {
    const now = Date.now()
    const { env, ref } = await withNewest(
      { role: 'assistant', time: { created: now, completed: now } },
      now,
    )

    expect(await opencodeAdapter.readTurnState?.(ref, env, now)).toBe('idle')
  })

  test('an assistant message still open is a model mid-stream', async () => {
    const now = Date.now()
    const { env, ref } = await withNewest({ role: 'assistant', time: { created: now } }, now)

    expect(await opencodeAdapter.readTurnState?.(ref, env, now)).toBe('working')
  })

  test('a user message is a model about to be called', async () => {
    const now = Date.now()
    const { env, ref } = await withNewest({ role: 'user', time: { created: now } }, now)

    expect(await opencodeAdapter.readTurnState?.(ref, env, now)).toBe('working')
  })

  test('the same open message is no evidence once it is stale', async () => {
    // A row left open an hour ago describes an agent that died mid-stream; calling that working
    // would hang every `all` wait until its timeout.
    const now = Date.now()
    const { env, ref } = await withNewest(
      { role: 'assistant', time: { created: now - 3_600_000 } },
      now - 3_600_000,
    )

    expect(await opencodeAdapter.readTurnState?.(ref, env, now)).toBeUndefined()
  })
})
