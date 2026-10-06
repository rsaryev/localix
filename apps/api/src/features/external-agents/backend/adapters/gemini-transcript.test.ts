import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { geminiCliAdapter } from './gemini-cli'
import { toAgentItems } from '../transcript/to-agent-items'
import type { AdapterEnv } from './types'

/**
 * A Gemini turn puts its TOOL CALLS beside the text, not inside it.
 *
 * A turn that only called tools records `content: ""` and everything else in `toolCalls`, and this
 * reader used to skip a message the moment its text was empty — so the tool half of every session
 * was dropped before anything else was read. Measured on a real recording under
 * ~/.gemini/tmp/<project>/chats: 148 of 193 messages carry `toolCalls`, and the largest session on
 * this machine went from 637 events of pure prose to 1773 once they were read.
 */
async function fixture(): Promise<AdapterEnv> {
  const home = await mkdtemp(join(tmpdir(), 'gemini-home-'))
  const chats = join(home, '.gemini', 'tmp', 'proj', 'chats')
  await mkdir(chats, { recursive: true })
  await writeFile(
    join(chats, 'session-2026-04-03T18-35-abcdef12.json'),
    JSON.stringify({
      sessionId: 'doc-side-id',
      projectHash: 'proj',
      startTime: '2026-04-03T18:35:00.000Z',
      lastUpdated: '2026-04-03T18:40:00.000Z',
      messages: [
        { id: 'm0', timestamp: '2026-04-03T18:35:01.000Z', type: 'user', content: 'find the flag' },
        {
          id: 'm1',
          timestamp: '2026-04-03T18:35:02.000Z',
          type: 'gemini',
          model: 'gemini-3-flash',
          tokens: { input: 100, cached: 40, output: 10, thoughts: 3, total: 110 },
          // The shape the bug turned on: no prose at all, only calls.
          content: '',
          toolCalls: [
            {
              id: 'grep_search-1775241465372-aaa',
              name: 'grep_search',
              args: { pattern: 'sandbox|image' },
              result: [
                {
                  functionResponse: {
                    id: 'grep_search-1775241465372-aaa',
                    name: 'grep_search',
                    response: { output: 'src/app.ts:12: sandbox' },
                  },
                },
              ],
            },
            {
              id: 'read_file-1775241465372-bbb',
              name: 'read_file',
              args: { path: 'src/app.ts' },
              // An envelope with no `output` key: kept, not dropped.
              result: [{ functionResponse: { response: { lines: 3 } } }],
            },
          ],
        },
        {
          id: 'm2',
          timestamp: '2026-04-03T18:36:00.000Z',
          type: 'gemini',
          model: 'gemini-3-flash',
          tokens: { input: 80, cached: 0, output: 5, thoughts: 1, total: 85 },
          content: 'Found it.',
        },
        // Neither dialogue nor a tool — Gemini's own bookkeeping, and not a transcript event.
        {
          id: 'm3',
          timestamp: '2026-04-03T18:36:10.000Z',
          type: 'info',
          content: 'Nothing to rewind to.',
        },
      ],
    }),
    'utf8',
  )
  return { env: {}, homeDir: home }
}

describe('the size ceiling is a disclaimer, so it is at least witnessed', () => {
  /**
   * This adapter parses a whole JSON document where the JSONL ones stream line by line, so
   * `MAX_FILE_BYTES` is a memory guard rather than a page size. Its consequence is unusual and worth
   * pinning: an oversized recording is not truncated, it never appears — the session is absent from
   * the roster with nothing saying why, and `ProviderStatus` has no channel for an omission.
   *
   * Measured on a real local history when the sweep was written: 29 recordings, largest 7.73 MB, none
   * skipped. The README lists this among the bounds that report nothing; this keeps the behaviour
   * from changing silently in either direction.
   */
  test('a recording past the ceiling is absent, and a normal one beside it still lists', async () => {
    const env = await fixture()
    const chats = join(env.homeDir, '.gemini', 'tmp', 'proj', 'chats')
    const oversized = join(chats, 'session-2026-04-04T09-00-toobig01.json')
    await writeFile(oversized, '{}', 'utf8')
    // Sparse: the ceiling is read from `stat`, so an apparent size is the whole test.
    await truncate(oversized, 17 * 1024 * 1024)

    const refs = await geminiCliAdapter.listSources(env)
    const names = refs.map((ref) => ref.nativeSessionId)

    expect(names).not.toContain('session-2026-04-04T09-00-toobig01')
    // The guard must skip only the oversized file, not abandon the directory.
    expect(names).toContain('session-2026-04-03T18-35-abcdef12')
  })
})

describe('a Gemini transcript carries the work, not only the prose', () => {
  test('every recorded call becomes a call event and its own result', async () => {
    const env = await fixture()
    const [ref] = await geminiCliAdapter.listSources(env)
    const { events, total } = await geminiCliAdapter.readTranscript(
      { ref: ref!, maxEvents: 100, maxCharsPerEvent: 4000 },
      env,
    )

    // user + two calls + two results + the closing assistant line. The `info` row is not one.
    expect(total).toBe(6)
    expect(events).toHaveLength(6)

    const calls = events.filter((e) => e.toolName)
    expect(calls.map((e) => e.toolName)).toEqual(['grep_search', 'read_file'])
    expect(calls[0]?.toolInput).toEqual({ pattern: 'sandbox|image' })
    // Arguments come from the record; they are never parsed back out of prose.
    expect(calls[1]?.toolInput).toEqual({ path: 'src/app.ts' })

    const results = events.filter((e) => e.role === 'tool')
    expect(results).toHaveLength(2)
    expect(results[0]?.text).toBe('src/app.ts:12: sandbox')
    // An unrecognised envelope is serialized rather than dropped: a call showing no OUT would read
    // as a call that returned nothing.
    expect(results[1]?.text).toBe('{"lines":3}')
    // A result is paired on the call's id, which is exact where adjacency is only a guess.
    expect(results[0]?.toolCallId).toBe(calls[0]?.toolCallId)
  })

  test('the projection renders each call as one card with both IN and OUT', async () => {
    const env = await fixture()
    const [ref] = await geminiCliAdapter.listSources(env)
    const { events } = await geminiCliAdapter.readTranscript(
      { ref: ref!, maxEvents: 100, maxCharsPerEvent: 4000 },
      env,
    )
    const items = toAgentItems(events, 'gemini-cli:session-2026-04-03T18-35-abcdef12')

    const tools = items.filter((item) => item.type === 'tool_call')
    expect(tools).toHaveLength(2)
    // Both halves present: the result was folded into its call rather than left standing alone.
    for (const tool of tools) expect(tool.input).toBeDefined()
    expect(items.filter((item) => item.type === 'text')).toHaveLength(2)
  })

  test('summary aggregates the provider token records without double-counting cache', async () => {
    const env = await fixture()
    const refs = await geminiCliAdapter.listSources(env)
    const [summary] = await geminiCliAdapter.readSummaries(refs, env)

    expect(summary?.messageCount).toBe(3)
    expect(summary?.usage).toMatchObject({
      inputTokens: 140,
      cachedInputTokens: 40,
      outputTokens: 19,
      reasoningTokens: 4,
      totalTokens: 195,
      requests: 2,
    })
    expect(summary?.usage?.byModel[0]?.model).toBe('gemini-3-flash')
  })
})

describe('gemini says whether a turn is running, from its document', () => {
  /**
   * Measured across 29 real recordings: the final message is `info` in 20, and every
   * `info` seen was "Request cancelled." Reading past those notices, the last real message is `user`
   * in 15, `gemini` in 8, `gemini` with tool calls in 4 and `error` in 2 — and of the four with
   * calls, NONE had a call still missing its result. This format records a call together with its
   * result, so a call is evidence of a running turn only while one is unfinished.
   */
  async function withMessages(messages: unknown[], mtimeMs = Date.now()) {
    const home = await mkdtemp(join(tmpdir(), 'gemini-turn-'))
    const chats = join(home, '.gemini', 'tmp', 'proj', 'chats')
    await mkdir(chats, { recursive: true })
    const file = join(chats, 'session-turn.json')
    await writeFile(
      file,
      JSON.stringify({ sessionId: 'doc', startTime: '2026-04-03T18:35:00.000Z', messages }),
      'utf8',
    )
    const env: AdapterEnv = { env: {}, homeDir: home }
    const ref = (await geminiCliAdapter.listSources(env)).find(
      (r) => r.nativeSessionId === 'session-turn',
    )!
    return { env, ref: { ...ref, updatedAtHint: mtimeMs } }
  }

  const user = { id: 'u', type: 'user', content: 'find the flag' }
  const answer = { id: 'g', type: 'gemini', content: 'Found it.' }
  const cancelled = { id: 'i', type: 'info', content: 'Request cancelled.' }

  test('a cancellation notice means nothing is running', async () => {
    // It sits ON TOP of a user message, which alone would read as a model being called.
    const { env, ref } = await withMessages([user, cancelled])

    expect(await geminiCliAdapter.readTurnState?.(ref, env, Date.now())).toBe('idle')
  })

  test('a plain answer is the turn handed back', async () => {
    const { env, ref } = await withMessages([user, answer])

    expect(await geminiCliAdapter.readTurnState?.(ref, env, Date.now())).toBe('idle')
  })

  test('a fresh user message is a model about to be called', async () => {
    const now = Date.now()
    const { env, ref } = await withMessages([answer, user], now)

    expect(await geminiCliAdapter.readTurnState?.(ref, env, now)).toBe('working')
  })

  test('a call that already carries its result is not a running turn', async () => {
    const { env, ref } = await withMessages([
      user,
      { id: 'g2', type: 'gemini', content: '', toolCalls: [{ name: 'grep', result: ['hit'] }] },
    ])

    expect(await geminiCliAdapter.readTurnState?.(ref, env, Date.now())).toBe('idle')
  })

  test('a call with no result yet is a turn in flight, while it is fresh', async () => {
    const now = Date.now()
    const { env, ref } = await withMessages(
      [user, { id: 'g3', type: 'gemini', content: '', toolCalls: [{ name: 'grep' }] }],
      now,
    )

    expect(await geminiCliAdapter.readTurnState?.(ref, env, now)).toBe('working')
  })

  test('the same unfinished call is no evidence once the document is stale', async () => {
    const now = Date.now()
    const { env, ref } = await withMessages(
      [user, { id: 'g3', type: 'gemini', content: '', toolCalls: [{ name: 'grep' }] }],
      now - 3_600_000,
    )

    expect(await geminiCliAdapter.readTurnState?.(ref, env, now)).toBeUndefined()
  })
})
