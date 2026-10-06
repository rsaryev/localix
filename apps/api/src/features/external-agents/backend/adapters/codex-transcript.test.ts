import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { codexAdapter } from './codex'
import type { AdapterEnv } from './types'

/**
 * A rollout is a conversation, and Codex records it in `response_item` records.
 *
 * The adapter used to read only the `event_msg` feed — Codex's own UI narration, which carries what
 * was SAID and nothing about what was DONE. On a real 691-line rollout that is 36 messages against
 * 121 tool calls: a tenth of the session, and none of the work.
 */
const ROLLOUT = [
  {
    type: 'session_meta',
    payload: {
      id: 'sess-1',
      cwd: '/work/app',
      source: {
        subagent: { thread_spawn: { parent_thread_id: 'parent-session', depth: 1 } },
      },
    },
    timestamp: '2026-08-01T21:48:05.000Z',
  },
  {
    type: 'turn_context',
    timestamp: '2026-08-01T21:48:16.500Z',
    payload: { model: 'gpt-5.6-sol' },
  },
  {
    type: 'event_msg',
    timestamp: '2026-08-01T21:48:17.000Z',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 40,
          output_tokens: 10,
          reasoning_output_tokens: 4,
          total_tokens: 110,
        },
      },
    },
  },
  {
    type: 'event_msg',
    timestamp: '2026-08-01T21:48:18.000Z',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: 160,
          cached_input_tokens: 80,
          output_tokens: 16,
          reasoning_output_tokens: 6,
          total_tokens: 176,
        },
      },
    },
  },
  {
    type: 'response_item',
    timestamp: '2026-08-01T21:48:10.000Z',
    payload: {
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: '<permissions instructions>' }],
    },
  },
  {
    type: 'response_item',
    timestamp: '2026-08-01T21:48:11.000Z',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'fix the parser' }],
    },
  },
  {
    type: 'response_item',
    timestamp: '2026-08-01T21:48:12.000Z',
    payload: { type: 'reasoning', summary: [], encrypted_content: 'gAAAA…' },
  },
  {
    type: 'response_item',
    timestamp: '2026-08-01T21:48:13.000Z',
    payload: {
      type: 'function_call',
      name: 'update_plan',
      call_id: 'call_1',
      arguments: '{"plan":[]}',
    },
  },
  {
    type: 'response_item',
    timestamp: '2026-08-01T21:48:14.000Z',
    payload: { type: 'function_call_output', call_id: 'call_1', output: 'Plan updated' },
  },
  {
    type: 'response_item',
    timestamp: '2026-08-01T21:48:15.000Z',
    payload: { type: 'custom_tool_call', name: 'exec', call_id: 'call_2', input: 'ls -la' },
  },
  {
    type: 'response_item',
    timestamp: '2026-08-01T21:48:16.000Z',
    payload: {
      type: 'custom_tool_call_output',
      call_id: 'call_2',
      output: [{ type: 'input_text', text: 'total 8' }],
    },
  },
  // The same user turn as above, echoed by the UI feed. Reading both streams would double it.
  {
    type: 'event_msg',
    timestamp: '2026-08-01T21:48:11.000Z',
    payload: { type: 'user_message', message: 'fix the parser' },
  },
]

async function fixture(): Promise<{ env: AdapterEnv }> {
  const home = await mkdtemp(join(tmpdir(), 'codex-rollout-'))
  const dir = join(home, '.codex', 'sessions', '2026', '08', '01')
  await mkdir(dir, { recursive: true })
  await writeFile(
    // Real rollout names carry the full session UUID; the adapter keys on that tail.
    join(dir, 'rollout-2026-08-01T21-48-05-019fbea7-a356-75a0-8d14-c3362752cc71.jsonl'),
    ROLLOUT.map((r) => JSON.stringify(r)).join('\n'),
    'utf8',
  )
  return { env: { env: {}, homeDir: home } }
}

describe('codex rollout as a conversation', () => {
  test('tool calls, their inputs and their outputs all survive', async () => {
    const { env } = await fixture()
    const refs = await codexAdapter.listSources(env)
    const result = await codexAdapter.readTranscript(
      { ref: refs[0]!, maxEvents: 100, maxCharsPerEvent: 1_000 },
      env,
    )

    const calls = result.events.filter((event) => event.toolName)
    expect(calls.map((c) => c.toolName)).toEqual(['update_plan', 'exec'])
    expect(calls.every((c) => c.toolInput !== undefined)).toBe(true)
    // The id is what pairs a call with its output; adjacency alone misattributes parallel calls.
    expect(calls.map((c) => c.toolCallId)).toEqual(['call_1', 'call_2'])

    const outputs = result.events.filter((event) => event.role === 'tool')
    expect(outputs.map((o) => o.toolCallId)).toEqual(['call_1', 'call_2'])
    expect(outputs[1]?.text).toBe('total 8')
  })

  test('the injected system prompt is not a turn anyone took', async () => {
    const { env } = await fixture()
    const refs = await codexAdapter.listSources(env)
    const result = await codexAdapter.readTranscript(
      { ref: refs[0]!, maxEvents: 100, maxCharsPerEvent: 1_000 },
      env,
    )
    expect(result.events.some((e) => e.text.includes('<permissions instructions>'))).toBe(false)
  })

  test('a user turn appears once, not once per stream', async () => {
    // It is recorded as a response_item AND echoed by the event_msg feed.
    const { env } = await fixture()
    const refs = await codexAdapter.listSources(env)
    const result = await codexAdapter.readTranscript(
      { ref: refs[0]!, maxEvents: 100, maxCharsPerEvent: 1_000 },
      env,
    )
    expect(result.events.filter((e) => e.text === 'fix the parser')).toHaveLength(1)
  })

  test('encrypted reasoning is skipped rather than shown as an empty row', async () => {
    const { env } = await fixture()
    const refs = await codexAdapter.listSources(env)
    const result = await codexAdapter.readTranscript(
      { ref: refs[0]!, maxEvents: 100, maxCharsPerEvent: 1_000 },
      env,
    )
    expect(result.events.some((e) => e.text.includes('gAAAA'))).toBe(false)
  })

  test('summary carries measured cumulative usage, model, and subagent parent', async () => {
    const { env } = await fixture()
    const refs = await codexAdapter.listSources(env)
    const [summary] = await codexAdapter.readSummaries(refs, env)

    expect(summary?.parentNativeSessionId).toBe('parent-session')
    expect(summary?.usage).toMatchObject({
      inputTokens: 80,
      cachedInputTokens: 80,
      outputTokens: 16,
      reasoningTokens: 6,
      totalTokens: 176,
      requests: 2,
    })
    expect(summary?.usage?.byModel[0]?.model).toBe('gpt-5.6-sol')
  })
})
