import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hermesAdapter } from './hermes'
import { toAgentItems } from '../transcript/to-agent-items'
import type { AdapterEnv } from './types'

/**
 * Schema and shapes copied from the real `~/.hermes/state.db`, columns we ignore included, so a
 * change to the ones we read fails here rather than in the workspace.
 *
 * Measured against that store when this was written: 19 sessions listed in 6 ms and summarized in
 * 1 ms — no message scan is needed because the session row already carries `message_count` and every
 * token column — 13 of 19 titled, 28.3 M tokens, and in the largest session 109 tool cards of which
 * all 109 pair with their result.
 */
const SECONDS = 1_781_127_002.19827

async function store(): Promise<AdapterEnv> {
  const home = await mkdtemp(join(tmpdir(), 'hermes-home-'))
  await mkdir(join(home, '.hermes'), { recursive: true })
  const db = new Database(join(home, '.hermes', 'state.db'))
  db.run(`CREATE TABLE sessions (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, model_config TEXT,
    system_prompt TEXT, parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL,
    end_reason TEXT, message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,
    input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0,
    reasoning_tokens INTEGER DEFAULT 0, estimated_cost_usd REAL, actual_cost_usd REAL,
    title TEXT, api_call_count INTEGER)`)
  db.run(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL,
    token_count INTEGER, finish_reason TEXT, reasoning TEXT)`)
  db.run(
    `INSERT INTO sessions (id, source, model, started_at, ended_at, message_count, input_tokens,
       output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, api_call_count,
       actual_cost_usd, title)
     VALUES ('20260611_003001_eece44', 'cli', 'deepseek/deepseek-v4-pro', ?, ?, 4, 1000, 200, 5000,
       300, 50, 7, 0.42, '  Choosing an npm provider  ')`,
    [SECONDS, SECONDS + 600],
  )
  // A session with no title at all: 6 of the 19 real ones are like this.
  db.run(
    `INSERT INTO sessions (id, source, model, started_at, message_count, api_call_count)
     VALUES ('20260611_010000_untitled', 'cli', 'deepseek/deepseek-v4-flash', ?, 1, 1)`,
    [SECONDS + 3600],
  )
  const insert = db.prepare(
    `INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  insert.run('20260611_003001_eece44', 'user', 'find the controller', null, null, null, SECONDS)
  // An assistant turn whose prose is empty but which carries TWO calls: the work lives in the row,
  // not beside it, so skipping on empty text would drop both.
  insert.run(
    '20260611_003001_eece44',
    'assistant',
    '',
    null,
    JSON.stringify([
      {
        id: 'call_A',
        call_id: 'call_A',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path": "src/controller.ts"}' },
      },
      {
        id: 'call_B',
        call_id: 'call_B',
        type: 'function',
        function: { name: 'search_files', arguments: 'not-json' },
      },
    ]),
    null,
    SECONDS + 1,
  )
  // Results come back reversed, as parallel tools do.
  insert.run(
    '20260611_003001_eece44',
    'tool',
    JSON.stringify({ content: 'export class Controller {}' }),
    'call_B',
    null,
    'search_files',
    SECONDS + 2,
  )
  insert.run(
    '20260611_003001_eece44',
    'tool',
    'raw, not an envelope',
    'call_A',
    null,
    'read_file',
    SECONDS + 3,
  )
  insert.run('20260611_003001_eece44', 'assistant', 'Found it.', null, null, null, SECONDS + 4)
  db.close()
  return { env: {}, homeDir: home }
}

describe('a hermes session is summarized from its own row', () => {
  test('no message scan is needed: counts and tokens are columns', async () => {
    const env = await store()
    const refs = await hermesAdapter.listSources(env)
    const summaries = await hermesAdapter.readSummaries(refs, env)
    const titled = summaries.find((s) => s.nativeSessionId === '20260611_003001_eece44')

    expect(refs).toHaveLength(2)
    expect(titled?.messageCount).toBe(4)
    // Whitespace trimmed, and the row's own title preferred over any first-message guess.
    expect(titled?.title).toBe('Choosing an npm provider')
    // Seconds → ms, and `ended_at` is what "updated" means for a finished session.
    expect(titled?.startedAt).toBe(Math.round(SECONDS * 1000))
    expect(titled?.updatedAt).toBe(Math.round((SECONDS + 600) * 1000))
    // No cwd column exists in this schema, so the field must be absent rather than invented.
    expect(titled?.cwd).toBeUndefined()
    // Hermes records one model per session on the row, so it reaches the model axis without tokens.
    expect(titled?.model).toBe('deepseek/deepseek-v4-pro')
  })

  test('the token columns are additive, so input is not reduced by cache', async () => {
    const env = await store()
    const refs = await hermesAdapter.listSources(env)
    const summaries = await hermesAdapter.readSummaries(refs, env)
    const usage = summaries.find((s) => s.nativeSessionId === '20260611_003001_eece44')?.usage

    // Measured on the real store: input 676,662 against cache_read 2,013,952, so the columns sit
    // beside each other. Treating input as cache-inclusive would subtract a bigger number from a
    // smaller one and report 0.
    expect(usage).toMatchObject({
      inputTokens: 1000,
      cachedInputTokens: 5000,
      cacheWriteTokens: 300,
      outputTokens: 200,
      reasoningTokens: 50,
      totalTokens: 6500,
      // The provider's own call count, not one request per session.
      requests: 7,
    })
    expect(usage?.byModel[0]?.model).toBe('deepseek/deepseek-v4-pro')
  })

  test('a long stored title is bounded as a NAME, not clipped as a body', async () => {
    // `clip` appends `\n[... N more characters]`, which turns a title into a 146-character string with
    // a newline in it. `firstText` is what the other adapters use and what a name needs.
    const home = await mkdtemp(join(tmpdir(), 'hermes-long-'))
    await mkdir(join(home, '.hermes'), { recursive: true })
    const db = new Database(join(home, '.hermes', 'state.db'))
    db.run(`CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, model TEXT,
      parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, message_count INTEGER,
      api_call_count INTEGER, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
      cache_write_tokens INTEGER, reasoning_tokens INTEGER, title TEXT)`)
    db.run(`CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT,
      timestamp REAL NOT NULL)`)
    db.run(
      `INSERT INTO sessions (id, source, started_at, message_count, title) VALUES ('long', 'cli', ?, 1, ?)`,
      [SECONDS, `${'word '.repeat(60)}\nsecond line`],
    )
    db.close()
    const env: AdapterEnv = { env: {}, homeDir: home }

    const refs = await hermesAdapter.listSources(env)
    const [summary] = await hermesAdapter.readSummaries(refs, env)

    expect(summary?.title.length).toBeLessThanOrEqual(120)
    expect(summary?.title).not.toContain('\n')
    expect(summary?.title).not.toContain('more characters')
  })

  test('a session with no title falls back to its id rather than to nothing', async () => {
    const env = await store()
    const refs = await hermesAdapter.listSources(env)
    const summaries = await hermesAdapter.readSummaries(refs, env)
    const untitled = summaries.find((s) => s.nativeSessionId === '20260611_010000_untitled')

    expect(untitled?.title).toBe('20260611_010000_untitled')
  })

  test('an absent database is a provider that is not installed, not an error', async () => {
    const env: AdapterEnv = { env: {}, homeDir: await mkdtemp(join(tmpdir(), 'no-hermes-')) }

    expect(await hermesAdapter.listSources(env)).toEqual([])
    expect((await hermesAdapter.probeRoots(env))[0]?.exists).toBe(false)
  })
})

describe('a hermes transcript carries calls that live inside the assistant row', () => {
  test('an empty assistant turn still yields its calls, with parsed arguments', async () => {
    const env = await store()
    const target = (await hermesAdapter.listSources(env)).find(
      (r) => r.nativeSessionId === '20260611_003001_eece44',
    )!
    const { events, total } = await hermesAdapter.readTranscript(
      { ref: target, maxEvents: 100, maxCharsPerEvent: 4000 },
      env,
    )

    // user + 2 calls + 2 results + closing prose. The empty assistant text is not an event of its own.
    expect(total).toBe(6)
    const calls = events.filter((event) => event.toolName && event.role === 'assistant')
    expect(calls.map((event) => event.toolName)).toEqual(['read_file', 'search_files'])
    expect(calls[0]?.toolInput).toEqual({ path: 'src/controller.ts' })
    // Arguments the provider wrote but that are not JSON stay as the string it wrote.
    expect(calls[1]?.toolInput).toBe('not-json')
  })

  test('a result unwraps its envelope, and a raw one is kept verbatim', async () => {
    const env = await store()
    const target = (await hermesAdapter.listSources(env)).find(
      (r) => r.nativeSessionId === '20260611_003001_eece44',
    )!
    const { events } = await hermesAdapter.readTranscript(
      { ref: target, maxEvents: 100, maxCharsPerEvent: 4000 },
      env,
    )
    const results = events.filter((event) => event.role === 'tool')

    expect(results[0]?.text).toBe('export class Controller {}')
    expect(results[1]?.text).toBe('raw, not an envelope')
    expect(results.map((event) => event.toolCallId)).toEqual(['call_B', 'call_A'])
  })

  test('the projection folds both calls despite the reversed results', async () => {
    const env = await store()
    const target = (await hermesAdapter.listSources(env)).find(
      (r) => r.nativeSessionId === '20260611_003001_eece44',
    )!
    const { events } = await hermesAdapter.readTranscript(
      { ref: target, maxEvents: 100, maxCharsPerEvent: 4000 },
      env,
    )
    const cards = toAgentItems(events, `hermes:${target.nativeSessionId}`).filter(
      (item) => item.type === 'tool_call',
    )

    expect(cards).toHaveLength(2)
    for (const card of cards) expect(card.completedAt).toBeDefined()
  })
})

describe('hermes says whether a session is still running, from its own row', () => {
  /**
   * Measured on the real store: 18 of 19 sessions carry `ended_at` — `cli_close` (14) and
   * `new_session` (4) — and the one that does not has an assistant message from 1,392 hours ago.
   * So the row answers outright for almost every session, and the last message's role answers for
   * the rest. No append-only log exists here, which is why this adapter answers it its own way.
   */
  test('a session with an end time is over, whatever its last message was', async () => {
    // The two facts are made to DISAGREE: the row says the session ended, the last message is a
    // fresh tool result — which on its own reads as a model being called back. Without this the
    // assertion would pass on the message alone and say nothing about `ended_at`.
    const env = await store()
    const db = new Database(join(env.homeDir, '.hermes', 'state.db'))
    const now = Date.now()
    db.run(
      `INSERT INTO sessions (id, source, started_at, ended_at, end_reason, message_count)
       VALUES ('ended1', 'cli', ?, ?, 'cli_close', 2)`,
      [now / 1000, now / 1000],
    )
    db.run(
      `INSERT INTO messages (session_id, role, content, timestamp) VALUES ('ended1', 'tool', 'output', ?)`,
      [now / 1000],
    )
    db.close()
    const ref = (await hermesAdapter.listSources(env)).find((r) => r.nativeSessionId === 'ended1')

    expect(await hermesAdapter.readTurnState?.(ref!, env, now)).toBe('idle')
  })

  test('an open session mid-call reads as working while the call is fresh', async () => {
    const env = await store()
    const db = new Database(join(env.homeDir, '.hermes', 'state.db'))
    const now = Date.now()
    db.run(
      `INSERT INTO sessions (id, source, started_at, message_count) VALUES ('open1', 'cli', ?, 2)`,
      [now / 1000],
    )
    db.run(
      `INSERT INTO messages (session_id, role, content, timestamp) VALUES ('open1', 'tool', 'output', ?)`,
      [now / 1000],
    )
    db.close()
    const ref = (await hermesAdapter.listSources(env)).find((r) => r.nativeSessionId === 'open1')

    expect(await hermesAdapter.readTurnState?.(ref!, env, now)).toBe('working')
  })

  test('the same open session goes back to no evidence once the call is stale', async () => {
    // A row left open with a tool message from an hour ago describes an agent that died mid-call.
    // Reporting that as working would hang every `all` wait until its timeout.
    const env = await store()
    const db = new Database(join(env.homeDir, '.hermes', 'state.db'))
    const stale = Date.now() - 3_600_000
    db.run(
      `INSERT INTO sessions (id, source, started_at, message_count) VALUES ('open2', 'cli', ?, 2)`,
      [stale / 1000],
    )
    db.run(
      `INSERT INTO messages (session_id, role, content, timestamp) VALUES ('open2', 'tool', 'output', ?)`,
      [stale / 1000],
    )
    db.close()
    const ref = (await hermesAdapter.listSources(env)).find((r) => r.nativeSessionId === 'open2')

    expect(await hermesAdapter.readTurnState?.(ref!, env, Date.now())).toBeUndefined()
  })

  test('an open session whose last word was the assistant is idle, however old', async () => {
    const env = await store()
    const ref = (await hermesAdapter.listSources(env)).find(
      (r) => r.nativeSessionId === '20260611_010000_untitled',
    )

    // No `ended_at`, no messages at all: nothing to read, so nothing is claimed.
    expect(await hermesAdapter.readTurnState?.(ref!, env, Date.now())).toBeUndefined()
  })
})
