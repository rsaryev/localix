import { describe, expect, test } from 'bun:test'
import type { LanguageModelRequest } from '@localixai/agent/runtime'
import { USER_PARTICIPANT } from '../../../db'
import type { StoredSystemNotice } from '../../../db'
import type { PersistedMessage } from '../contracts'
import { RECAP_AFTER_MS } from './eligibility'
import { createRecapService, RECAP_MAX_CHARS } from './service'

const T0 = Date.parse('2026-10-25T10:00:00.000Z')

function row(
  id: string,
  at: number,
  role: 'user' | 'assistant',
  content: string,
): PersistedMessage {
  const iso = new Date(at).toISOString()
  return {
    id,
    sessionId: 's1',
    userId: 'u1',
    createdAt: iso,
    updatedAt: iso,
    payload: { id, role, from: USER_PARTICIPANT, content } as never,
  }
}

const talk = (turns: number): PersistedMessage[] =>
  Array.from({ length: turns }, (_, i) => [
    row(`u${i}`, T0 - (turns - i) * 1000 - 500, 'user', `question ${i}`),
    row(`a${i}`, T0 - (turns - i) * 1000, 'assistant', `answer ${i}`),
  ]).flat()

interface Options {
  rows?: PersistedMessage[]
  routing?: Record<string, unknown>
  reply?: string
  nowMs?: number
  running?: boolean
  fail?: boolean
  /** Rows the person adds while the model is thinking. */
  duringCall?: () => void
}

function harness(options: Options = {}) {
  const state = { rows: options.rows ?? talk(3) }
  const notes: { notice: StoredSystemNotice; settle: boolean }[] = []
  const requests: { request: LanguageModelRequest; modelId: string; hint?: string | null }[] = []
  const usage: unknown[] = []
  let modelCalls = 0
  const service = createRecapService({
    repo: {
      getSession: async () =>
        ({
          id: 's1',
          runtimeStatus: options.running ? 'running' : 'idle',
          agents: [{ providerConnectionId: 'chat-connection', modelId: 'chat-model' }],
        }) as never,
      listMessages: async () => state.rows,
    },
    readAgentSettings: async () => ({ modelRouting: options.routing ?? {} }) as never,
    buildLanguageModel: async (_user, modelId, hint) => ({
      providerConnectionId: 'built-connection',
      providerId: 'prov',
      model: {
        complete: async (request: LanguageModelRequest) => {
          modelCalls++
          requests.push({ request, modelId, hint })
          options.duringCall?.()
          if (options.fail) throw new Error('provider down')
          return { content: options.reply ?? 'You were fixing login.', usage: { inputTokens: 5 } }
        },
      } as never,
    }),
    insertNotice: async (_user, _session, notice, settle) => {
      notes.push({ notice, settle })
      return { messageId: 'recap-1' }
    },
    nowMs: () => options.nowMs ?? T0 + RECAP_AFTER_MS,
    recordUsage: (entry) => usage.push(entry),
  })
  return { service, state, notes, requests, usage, calls: () => modelCalls }
}

describe('recap service', () => {
  test('writes a one-line recap into the transcript after a break, as a record only', async () => {
    const h = harness({ reply: '  "You were fixing login;\nnext is the cookie."  ' })
    const result = await h.service.recap('u1', 's1', 'auto')

    expect(result).toEqual({
      status: 'created',
      messageId: 'recap-1',
      text: 'You were fixing login; next is the cookie.',
    })
    expect(h.notes).toEqual([
      {
        notice: {
          kind: 'session_recap',
          tone: 'neutral',
          text: 'You were fixing login; next is the cookie.',
        },
        settle: false,
      },
    ])
  })

  test('caps the recap at 400 characters', async () => {
    const h = harness({ reply: 'word '.repeat(200) })
    const result = await h.service.recap('u1', 's1', 'auto')
    expect(result.status).toBe('created')
    const text = (result as { text: string }).text
    expect(text.length).toBeLessThanOrEqual(RECAP_MAX_CHARS)
    expect(text.endsWith('…')).toBe(true)
  })

  test('shows the model the conversation, but not an earlier recap', async () => {
    const rows = [
      ...talk(3),
      {
        ...row('r0', T0 - 100, 'user', 'OLD RECAP TEXT'),
        payload: {
          id: 'r0',
          role: 'user',
          from: 'system',
          content: 'OLD RECAP TEXT',
          uiOnly: true,
          systemNotice: { kind: 'session_recap', tone: 'neutral', text: 'OLD RECAP TEXT' },
        },
      } as PersistedMessage,
    ]
    const h = harness({ rows, nowMs: T0 + RECAP_AFTER_MS + 1 })
    // An earlier recap with no turn after it blocks an automatic one; ask for it on demand.
    await h.service.recap('u1', 's1', 'command')

    const sent = JSON.stringify(h.requests[0]!.request.messages)
    expect(sent).toContain('question 0')
    expect(sent).toContain('answer 2')
    expect(sent).not.toContain('OLD RECAP TEXT')
  })

  test('uses its own picker row: model, connection hint and reasoning effort', async () => {
    const h = harness({
      routing: {
        sessionRecap: {
          modelId: 'recap-model',
          providerConnectionId: 'recap-connection',
          reasoningEffort: 'low',
        },
      },
    })
    await h.service.recap('u1', 's1', 'auto')
    expect(h.requests[0]).toMatchObject({
      modelId: 'recap-model',
      hint: 'recap-connection',
      request: { reasoningEffort: 'low' },
    })
    expect(h.usage).toHaveLength(1)
  })

  test('without a chosen model it uses the chat model, at the workload’s own effort', async () => {
    const h = harness({ routing: { sessionRecap: { reasoningEffort: 'minimal' } } })
    await h.service.recap('u1', 's1', 'auto')
    expect(h.requests[0]).toMatchObject({
      modelId: 'chat-model',
      hint: 'chat-connection',
      request: { reasoningEffort: 'minimal' },
    })
  })

  test('does nothing when the person switched automatic recaps off', async () => {
    const h = harness({ routing: { sessionRecap: { enabled: false } } })
    expect(await h.service.recap('u1', 's1', 'auto')).toEqual({
      status: 'skipped',
      reason: 'disabled',
    })
    expect(h.calls()).toBe(0)
    expect(h.notes).toEqual([])
  })

  test('/recap still works with automatic recaps off, and settles the typed command', async () => {
    const h = harness({ routing: { sessionRecap: { enabled: false } }, nowMs: T0 })
    const result = await h.service.recap('u1', 's1', 'command', { settleOptimistic: true })
    expect(result.status).toBe('created')
    expect(h.notes[0]!.settle).toBe(true)
  })

  test('skips quietly while the session is too young, still running or too fresh', async () => {
    expect(await harness({ rows: talk(2) }).service.recap('u1', 's1', 'auto')).toMatchObject({
      reason: 'too-few-turns',
    })
    expect(await harness({ running: true }).service.recap('u1', 's1', 'auto')).toMatchObject({
      reason: 'running',
    })
    expect(await harness({ nowMs: T0 }).service.recap('u1', 's1', 'auto')).toMatchObject({
      reason: 'too-soon',
    })
  })

  test('two windows asking at once produce one recap', async () => {
    const h = harness()
    const [a, b] = await Promise.all([
      h.service.recap('u1', 's1', 'auto'),
      h.service.recap('u1', 's1', 'auto'),
    ])
    expect([a.status, b.status].sort()).toEqual(['created', 'skipped'])
    expect(h.calls()).toBe(1)
    expect(h.notes).toHaveLength(1)
  })

  test('drops a recap when the person moved on while it was being written', async () => {
    const h = harness({
      duringCall: () => {
        h.state.rows = [...h.state.rows, row('u9', T0 + 1, 'user', 'new question')]
      },
    })
    expect(await h.service.recap('u1', 's1', 'auto')).toEqual({
      status: 'skipped',
      reason: 'stale',
    })
    expect(h.notes).toEqual([])
  })

  test('a failing model leaves the transcript alone', async () => {
    const h = harness({ fail: true })
    expect(await h.service.recap('u1', 's1', 'auto')).toEqual({ status: 'unavailable' })
    expect(h.notes).toEqual([])
  })
})
