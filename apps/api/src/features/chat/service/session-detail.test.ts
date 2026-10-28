import { describe, expect, spyOn, test } from 'bun:test'
import { createHitlRegistry } from '../runtime/hitl-registry'
import { getSessionDetail, type SessionDetailContext } from './session-detail'
import type { PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'
import { DEFAULT_AGENT_AUTHOR } from '../../../db'

const session = {
  id: 's1',
  seq: 1,
  title: 'Long session',
  providerConnectionId: null,
  modelId: 'model',
  reasoningEffort: 'medium',
  isPinned: false,
  archivedAt: null,
  projectId: null,
  parentSessionId: null,
  rootSessionId: null,
  sessionKind: 'chat',
  runtimeStatus: 'idle',
  sourceToolCallId: null,
  pinnedSkills: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastMessageAt: null,
} as unknown as SessionRecord

/** A session no checkpoint has touched: the detail carries no model-view divider. */
const noModelContexts = {
  list: async () => new Map(),
  getCheckpoint: async () => undefined,
}

function message(index: number): PersistedMessage {
  return {
    id: `m${index}`,
    sessionId: 's1',
    userId: 'u1',
    payload: {
      id: `m${index}`,
      role: 'assistant',
      from: DEFAULT_AGENT_AUTHOR,
      content: `turn ${index}`,
      usage: {
        totalTokens: 10,
        inputTokens: 7,
        outputTokens: 3,
        cachedInputTokens: 4,
        cacheWriteTokens: 1,
        cacheWrite1hTokens: 1,
        reasoningTokens: 2,
        totalCost: 0.001,
        costSource: 'subscription',
      },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('getSessionDetail long-history accounting', () => {
  test('messageLimit slices payload but sessionUsage covers every persisted message', async () => {
    const messages = Array.from({ length: 175 }, (_, index) => message(index))
    const ctx = {
      modelContexts: noModelContexts,
      repo: { listMessages: async () => messages },
      usageRepo: { queryStats: async () => [] },
      projectsRepo: {},
      hitlRegistry: createHitlRegistry(),
      requireSession: async () => session,
      runner: {
        isRunning: () => false,
        listWork: () => [],
        listQueued: () => [],
      },
      lspManager: undefined,
    } as unknown as SessionDetailContext

    const detail = await getSessionDetail(ctx, 'u1', 's1', { messageLimit: 120 })

    expect(detail.messages).toHaveLength(120)
    expect(detail.messageCount).toBe(175)
    expect(detail.sessionUsage).toMatchObject({
      totalTokens: 1_750,
      inputTokens: 1_225,
      outputTokens: 525,
      cachedInputTokens: 700,
      cacheWriteTokens: 175,
      cacheWrite1hTokens: 175,
      reasoningTokens: 350,
      costSource: 'subscription',
      isSummary: true,
    })
    expect(detail.sessionUsage?.totalCost).toBeCloseTo(0.175, 10)
  })

  test('a fork shows and counts only its own rows, not the parent line it reads', async () => {
    const own = { ...message(9), id: 'own', sessionId: 'fork' }
    const inherited = [message(1), message(2)]
    const fork = { ...session, id: 'fork', parentSessionId: 's1', rootSessionId: 's1' }
    const ctx = {
      modelContexts: noModelContexts,
      repo: { listMessages: async () => [...inherited, own] },
      usageRepo: { queryStats: async () => [] },
      projectsRepo: {},
      hitlRegistry: createHitlRegistry(),
      requireSession: async () => fork,
      runner: {
        isRunning: () => false,
        listWork: () => [],
        listQueued: () => [],
      },
      lspManager: undefined,
    } as unknown as SessionDetailContext
    const detail = await getSessionDetail(ctx, 'u1', 'fork')
    expect(detail.messages.map((row) => row.id)).toEqual(['own'])
    expect(detail.messageCount).toBe(1)
    expect(detail.sessionUsage).toMatchObject({ totalTokens: 10 })
  })

  test('a root detail carries its plans; a child, or an unreadable list, carries none', async () => {
    const asked: string[] = []
    const ctxFor = (record: SessionRecord, fail = false) =>
      ({
        modelContexts: noModelContexts,
        repo: { listMessages: async () => [] },
        usageRepo: { queryStats: async () => [] },
        projectsRepo: {},
        hitlRegistry: createHitlRegistry(),
        requireSession: async () => record,
        runner: {
          isRunning: () => false,
          listWork: () => [],
          listQueued: () => [],
        },
        lspManager: undefined,
        plans: async (_user: string, id: string) => {
          asked.push(id)
          if (fail) throw new Error('environment unreachable')
          return [{ id: 'p1', version: 1, status: 'approved' }]
        },
      }) as unknown as SessionDetailContext
    const root = await getSessionDetail(ctxFor(session), 'u1', 's1')
    expect(root.plans).toEqual([expect.objectContaining({ id: 'p1', status: 'approved' })] as never)
    const child = { ...session, id: 'c1', parentSessionId: 's1', rootSessionId: 's1' }
    expect('plans' in (await getSessionDetail(ctxFor(child as SessionRecord), 'u1', 'c1'))).toBe(
      false,
    )
    // A failed read is "unknown" (absent) — never a false "none" that would erase the client's list.
    expect('plans' in (await getSessionDetail(ctxFor(session, true), 'u1', 's1'))).toBe(false)
    expect(asked).toEqual(['s1', 's1'])
  })

  test('point-reads a child session source tool call instead of hydrating its parent', async () => {
    const child = {
      ...session,
      id: 'child',
      parentSessionId: 'parent',
      rootSessionId: 'parent',
      sessionKind: 'subagent',
      sourceToolCallId: 'call-1',
    } as SessionRecord
    const sourceMessage: PersistedMessage = {
      ...message(1),
      id: 'source-message',
      sessionId: 'parent',
      payload: {
        id: 'source-message',
        role: 'assistant',
        from: DEFAULT_AGENT_AUTHOR,
        items: [
          {
            id: 'call-1',
            status: 'completed',
            type: 'tool_call',
            toolCallId: 'call-1',
            name: 'agents',
            input: {
              action: 'delegate',
              agent: '@backend',
              title: 'Inspect the parser',
              prompt: 'Find the hot path',
            },
            activeVerb: 'Delegating',
          },
        ],
      },
    }
    let parentTranscriptReads = 0
    let sourcePointReads = 0
    const ctx = {
      modelContexts: noModelContexts,
      repo: {
        listMessages: async (_userId: string, sessionId: string) => {
          if (sessionId === 'parent') parentTranscriptReads += 1
          return sessionId === 'child' ? [] : [sourceMessage]
        },
        findActiveBranchToolCallMessage: async () => {
          sourcePointReads += 1
          return sourceMessage
        },
      },
      usageRepo: { queryStats: async () => [] },
      projectsRepo: {},
      hitlRegistry: createHitlRegistry(),
      requireSession: async () => child,
      runner: {
        isRunning: () => false,
        listWork: () => [],
        listQueued: () => [],
      },
      lspManager: undefined,
    } as unknown as SessionDetailContext

    const detail = await getSessionDetail(ctx, 'u1', 'child')

    expect(parentTranscriptReads).toBe(0)
    expect(sourcePointReads).toBe(1)
    expect(detail.sourceRuntime).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'agents',
    })
  })

  test('adds auxiliary ledger spend without double-counting turn rows', async () => {
    const messages = [message(1)]
    const ctx = {
      modelContexts: noModelContexts,
      repo: { listMessages: async () => messages },
      usageRepo: {
        queryStats: async () => [
          {
            key: 'turn',
            inputTokens: 7,
            outputTokens: 3,
            cacheReadTokens: 4,
            cacheWriteTokens: 1,
            cacheWrite1hTokens: 1,
            reasoningTokens: 2,
            totalTokens: 10,
            costUsd: 0.001,
            messages: 1,
            actualCostMessages: 0,
            subscriptionMessages: 1,
            subscriptionCostUsd: 0.001,
          },
          {
            key: 'compaction',
            inputTokens: 40,
            outputTokens: 5,
            cacheReadTokens: 20,
            cacheWriteTokens: 2,
            cacheWrite1hTokens: 2,
            reasoningTokens: 0,
            totalTokens: 45,
            costUsd: 0.02,
            messages: 1,
            actualCostMessages: 1,
            subscriptionMessages: 0,
            subscriptionCostUsd: 0,
          },
        ],
      },
      projectsRepo: {},
      hitlRegistry: createHitlRegistry(),
      requireSession: async () => session,
      runner: {
        isRunning: () => false,
        listWork: () => [],
        listQueued: () => [],
      },
      lspManager: undefined,
    } as unknown as SessionDetailContext

    const detail = await getSessionDetail(ctx, 'u1', 's1')
    expect(detail.sessionUsage).toMatchObject({
      totalTokens: 55,
      inputTokens: 47,
      outputTokens: 8,
      cachedInputTokens: 24,
      cacheWriteTokens: 3,
      cacheWrite1hTokens: 3,
      totalCost: 0.021,
      costSource: 'estimated',
    })
  })

  test('carries the server-owned active terminal-wait snapshot', async () => {
    const ctx = {
      modelContexts: noModelContexts,
      repo: { listMessages: async () => [] },
      usageRepo: { queryStats: async () => [] },
      projectsRepo: {},
      hitlRegistry: createHitlRegistry(),
      requireSession: async () => session,
      runner: {
        isRunning: () => true,
        listWork: () => [
          {
            id: 'bg-1',
            kind: 'job' as const,
            label: 'bun dev',
            startedAt: '2026-09-23T10:00:00.000Z',
            toolCallId: 'tc-1',
            terminalId: 'pty-1',
          },
        ],
        listQueued: () => [],
        getTerminalWaits: () => [{ terminalId: 'pty-1', label: 'waiting for prompt' }],
      },
      lspManager: undefined,
    } as unknown as SessionDetailContext

    const detail = await getSessionDetail(ctx, 'u1', 's1')
    expect(detail.terminalWaits).toEqual([{ terminalId: 'pty-1', label: 'waiting for prompt' }])
    // …and what is running in the background, before the next work push arrives.
    expect(detail.work.map((item) => item.id)).toEqual(['bg-1'])
  })

  test('opens from message usage when the secondary ledger is unavailable', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const ctx = {
        modelContexts: noModelContexts,
        repo: { listMessages: async () => [message(1)] },
        usageRepo: {
          queryStats: async () => {
            throw new Error('SQLITE_BUSY')
          },
        },
        projectsRepo: {},
        hitlRegistry: createHitlRegistry(),
        requireSession: async () => session,
        runner: {
          isRunning: () => false,
          listWork: () => [],
          listQueued: () => [],
        },
        lspManager: undefined,
      } as unknown as SessionDetailContext

      const detail = await getSessionDetail(ctx, 'u1', 's1')
      expect(detail.sessionUsage?.totalTokens).toBe(10)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('getSessionDetail model view', () => {
  // A reload must redraw the checkpoint divider where the live event put it, or the person
  // loses the only sign that the agent no longer sees the turns above it.
  test('surfaces where the newest checkpoint cut the agent view', async () => {
    const messages = [message(1), message(2), message(3)]
    const ctx = {
      modelContexts: {
        list: async () => new Map([['m3', { messageId: 'm3', hasCheckpoint: true }]]),
        getCheckpoint: async () => ({ version: 1, evictedThroughId: 'm1' }),
      },
      repo: { listMessages: async () => messages },
      usageRepo: { queryStats: async () => [] },
      projectsRepo: {},
      hitlRegistry: createHitlRegistry(),
      requireSession: async () => session,
      runner: {
        isRunning: () => false,
        listWork: () => [],
        listQueued: () => [],
      },
      lspManager: undefined,
    } as unknown as SessionDetailContext

    const detail = await getSessionDetail(ctx, 'u1', 's1')
    expect(detail.modelView).toEqual({
      agentId: expect.any(String),
      evictedThroughId: 'm1',
    })
  })

  test('a session no checkpoint has cut has no divider', async () => {
    const ctx = {
      modelContexts: noModelContexts,
      repo: { listMessages: async () => [message(1)] },
      usageRepo: { queryStats: async () => [] },
      projectsRepo: {},
      hitlRegistry: createHitlRegistry(),
      requireSession: async () => session,
      runner: {
        isRunning: () => false,
        listWork: () => [],
        listQueued: () => [],
      },
      lspManager: undefined,
    } as unknown as SessionDetailContext
    expect((await getSessionDetail(ctx, 'u1', 's1')).modelView).toBeNull()
  })
})
