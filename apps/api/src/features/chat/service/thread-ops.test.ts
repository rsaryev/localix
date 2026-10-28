import { describe, expect, test } from 'bun:test'

import type { SessionRecord } from '../repository'
import { openMessageThread, type ThreadOpsContext } from './thread-ops'
import { routedAgent, sessionFixture } from '../../../testing/session-fixture'

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return sessionFixture({
    id: 'thread',
    userId: 'user-a',
    seq: 2,
    title: 'Thread',
    agent: routedAgent({ modelId: '', reasoningEffort: 'low' }),
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    lastMessageAt: '2026-07-31T00:00:00.000Z',
    parentSessionId: 'parent',
    rootSessionId: 'parent',
    sourceToolCallId: 'message-thread:anchor',
    provenance: { kind: 'thread', parentSessionId: 'parent', phase: 'message' },
    ...overrides,
  })
}

describe('openMessageThread', () => {
  test('reopens an existing thread without loading the session roster', async () => {
    let pointReads = 0
    let rosterReads = 0
    const existing = session()
    const ctx = {
      repo: {
        findSessionByParentAndSource: async (
          userId: string,
          parentSessionId: string,
          sourceToolCallId: string,
        ) => {
          pointReads += 1
          expect({ userId, parentSessionId, sourceToolCallId }).toEqual({
            userId: 'user-a',
            parentSessionId: 'parent',
            sourceToolCallId: 'message-thread:anchor',
          })
          return existing
        },
        listSessions: async () => {
          rosterReads += 1
          return [existing]
        },
      },
      requireSession: async () => session({ id: 'parent', parentSessionId: null }),
      getSessionDetail: async () => ({ id: existing.id }),
    } as unknown as ThreadOpsContext

    const detail = await openMessageThread(ctx, 'user-a', 'parent', 'anchor')

    expect(detail.id).toBe('thread')
    expect({ pointReads, rosterReads }).toEqual({ pointReads: 1, rosterReads: 0 })
  })

  test('creates a thread from one message lookup without loading the transcript', async () => {
    let rosterReads = 0
    let transcriptReads = 0
    let messageReads = 0
    const parent = session({
      id: 'parent',
      parentSessionId: null,
      rootSessionId: 'parent',
      sourceToolCallId: null,
      provenance: { kind: 'root' },
    })
    const anchor = {
      id: 'anchor',
      sessionId: 'parent',
      userId: 'user-a',
      payload: { id: 'anchor', role: 'assistant' as const, content: 'Anchor answer' },
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
    }
    const lifecycleRepo = {
      listSessions: async () => [],
      listSessionAncestry: async () => [],
      allocateSessionRef: async () => ({ seq: 2, id: 'thread' }),
      insertSession: async () => {},
      updateSession: async () => {},
      deleteSession: async () => {},
      listChildSessionIds: async () => [],
    }
    const ctx = {
      repo: {
        findSessionByParentAndSource: async () => null,
        listSessions: async () => {
          rosterReads += 1
          return []
        },
        getMessage: async () => {
          messageReads += 1
          return anchor
        },
        listMessages: async () => {
          transcriptReads += 1
          return [anchor]
        },
        insertMessage: async () => {},
      },
      requireSession: async () => parent,
      getSessionDetail: async (_userId: string, id: string) => ({ id }),
      now: () => '2026-07-31T00:00:00.000Z',
      streamRegistry: { publish: () => {} },
      sessionLifecycleCtx: {
        repo: lifecycleRepo,
        streamRegistry: { publish: () => {} },
        runner: {
          withSessionsQuiesced: async <T>(_ids: readonly string[], operation: () => Promise<T>) =>
            operation(),
          stop: async () => true,
          forgetSession: async () => {},
        },
        now: () => '2026-07-31T00:00:00.000Z',
        requireSession: async () => parent,
        getSessionDetail: async (_userId: string, id: string) => ({ id }),
        publishSession: () => {},
      },
    } as unknown as ThreadOpsContext

    const detail = await openMessageThread(ctx, 'user-a', 'parent', 'anchor')

    expect(detail.id).toBe('thread')
    expect({ rosterReads, transcriptReads, messageReads }).toEqual({
      rosterReads: 0,
      transcriptReads: 0,
      messageReads: 1,
    })
  })
})
