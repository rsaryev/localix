import { describe, expect, test } from 'bun:test'
import type { Message } from '@/entities/chat/model/types'
import { createChatSurfaceSnapshotSelector } from './chatSurfaceSnapshot'

const message = (value: Partial<Message> & Pick<Message, 'id' | 'role'>): Message =>
  value as Message

describe('chat surface snapshot performance contract', () => {
  test('derives once per message-array identity and returns the same snapshot', () => {
    const visits: number[] = []
    const select = createChatSurfaceSnapshotSelector((metrics) =>
      visits.push(metrics.messagesVisited),
    )
    const messages = [message({ id: 'u1', role: 'user', content: 'hello' })]

    const first = select(messages)
    const second = select(messages)

    expect(second).toBe(first)
    expect(visits).toEqual([1])
  })

  test('collects user, tool, usage and cache tails in one transcript visit', () => {
    const cacheDiagnostics = { snapshot: { modelId: 'm' } } as never
    const messages: Message[] = [
      message({ id: 'u1', role: 'user', content: 'first' }),
      message({
        id: 'a1',
        role: 'assistant',
        usage: { totalTokens: 10, inputTokens: 8, totalCost: 0.1 },
      }),
      message({ id: 'u2', role: 'user', content: 'latest' }),
      message({
        id: 'a2',
        role: 'assistant',
        usage: { totalTokens: 5, outputTokens: 3 },
        cacheDiagnostics,
        items: [{ type: 'command', status: 'running', command: 'pwd', input: {} }] as never,
      }),
    ]
    const visits: number[] = []

    const snapshot = createChatSurfaceSnapshotSelector((metrics) =>
      visits.push(metrics.messagesVisited),
    )(messages)

    expect(snapshot.userText).toBe('latest')
    expect(snapshot.activeToolName).toBe('bash')
    expect(snapshot.lastSuccessfulUsage).toBe(messages[3]!.usage)
    expect(snapshot.latestContextAttempt).toEqual({
      messageId: 'a2',
      outcome: 'succeeded',
      stage: 'provider',
      contextTokens: undefined,
      tokenKind: 'unknown',
    })
    expect(snapshot.sessionUsage).toMatchObject({
      totalTokens: 15,
      inputTokens: 8,
      outputTokens: 3,
      totalCost: 0.1,
      isSummary: true,
    })
    expect(snapshot.latestCacheDiagnostics).toBe(cacheDiagnostics)
    expect(visits).toEqual([messages.length])
  })

  test('does not present stale usage as the latest request after a trailing failure', () => {
    const previousUsage = {
      totalTokens: 143_663,
      inputTokens: 143_510,
      outputTokens: 153,
      contextTokens: 143_663,
    }
    const messages: Message[] = [
      message({ id: 'a1', role: 'assistant', usage: previousUsage }),
      message({ id: 'u2', role: 'user', content: 'loop wake' }),
      message({
        id: 'a2',
        role: 'assistant',
        dataParts: [
          {
            type: 'data-chat-error',
            data: {
              code: 'context_window_exceeded',
              title: 'Context window exceeded',
              message: 'The attempt failed before usage was recorded.',
            },
          },
        ],
      }),
    ]

    const snapshot = createChatSurfaceSnapshotSelector()(messages)

    expect(snapshot.lastSuccessfulUsage).toBe(previousUsage)
    expect(snapshot.latestContextAttempt).toEqual({
      messageId: 'a2',
      outcome: 'failed',
      stage: 'unknown',
      tokenKind: 'unknown',
    })
    expect(snapshot.sessionUsage?.totalTokens).toBe(143_663)
  })

  test('collects the latest context budget separately from provider usage', () => {
    const contextWindow = {
      sessionId: 's1',
      fullWindowTokens: 272_000,
      policyWindowTokens: 256_000,
      ceilingTokens: 230_400,
      checkpointAtTokens: 217_600,
      reservedTokens: 25_600,
      activeTokens: 232_388,
      activeTokensKind: 'estimated',
    } as const
    const messages: Message[] = [
      message({
        id: 'a1',
        role: 'assistant',
        dataParts: [{ type: 'data-context-window', data: contextWindow }],
      }),
    ]

    expect(createChatSurfaceSnapshotSelector()(messages).latestContextWindow).toBe(contextWindow)
  })

  test('updates a streaming tail in O(1) for a 100k-message transcript', () => {
    const visits: number[] = []
    const select = createChatSurfaceSnapshotSelector((metrics) =>
      visits.push(metrics.messagesVisited),
    )
    const messages = Array.from({ length: 100_000 }, (_, index) =>
      message({
        id: `m-${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `message ${index}`,
      }),
    )
    const first = select(messages)
    const updatedTail = message({
      ...messages.at(-1),
      id: 'm-99999',
      role: 'assistant',
      content: 'stream delta',
      items: [{ id: 'cmd', type: 'command', status: 'running', command: 'pwd' }] as never,
    })
    const next = [...messages.slice(0, -1), updatedTail]

    const second = select(next)

    expect(second).not.toBe(first)
    expect(second.activeToolName).toBe('bash')
    expect(second.sessionUsage).toBe(first.sessionUsage)
    expect(visits).toEqual([100_000, 1])
  })
})
