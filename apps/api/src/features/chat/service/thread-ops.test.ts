import { describe, expect, test } from 'bun:test'

import type { SessionRecord } from '../repository'
import { openMessageThread, type ThreadOpsContext } from './thread-ops'
import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return sessionFixture({
    id: 'thread',
    userId: 'user-a',
    seq: 2,
    title: 'Thread',
    agents: routedParticipants({ modelId: '', reasoningEffort: 'low' }),
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

  test("a thread on one participant's reply continues with that participant", async () => {
    // It used to take the FIRST participant for the route, the seat and the opener's author,
    // so a thread opened on @qa's reply was answered — and "written" — by @lead.
    const parent = session({
      id: 'parent',
      parentSessionId: null,
      rootSessionId: 'parent',
      sourceToolCallId: null,
      provenance: { kind: 'root' },
      agents: [
        ...routedParticipants({ agentId: 'lead', handle: 'lead', modelId: 'lead-model' }),
        ...routedParticipants({ agentId: 'qa', handle: 'qa', modelId: 'qa-model' }),
      ],
    })
    const anchor = {
      id: 'anchor',
      sessionId: 'parent',
      userId: 'user-a',
      payload: { id: 'anchor', role: 'assistant' as const, from: 'agent:qa', content: 'QA says' },
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
    }
    const born: SessionRecord[] = []
    const seeded: Array<{ payload: { from?: string } }> = []
    const lifecycleCtx = {
      repo: {
        listSessions: async () => [],
        listSessionAncestry: async () => [],
        allocateSessionRef: async () => ({ seq: 2, id: 'thread' }),
        insertSession: async (record: SessionRecord) => {
          born.push(record)
        },
        updateSession: async () => {},
        deleteSession: async () => {},
        listChildSessionIds: async () => [],
      },
      streamRegistry: { publish: () => {} },
      now: () => '2026-07-31T00:00:00.000Z',
      requireSession: async () => parent,
      getSessionDetail: async (_userId: string, id: string) => ({ id }),
      publishSession: () => {},
      resolveDefaultProjectId: async () => 'PRJ-1',
      resolveSessionAgent: async (_u: string, selection: { agentId?: string }) =>
        selection.agentId ? { id: selection.agentId, handle: selection.agentId } : null,
    }
    const ctx = {
      repo: {
        findSessionByParentAndSource: async () => null,
        getMessage: async () => anchor,
        insertMessage: async (message: { payload: { from?: string } }) => {
          seeded.push(message)
        },
      },
      requireSession: async () => parent,
      getSessionDetail: async (_userId: string, id: string) => ({ id }),
      now: () => '2026-07-31T00:00:00.000Z',
      sessionLifecycleCtx: lifecycleCtx,
    } as unknown as ThreadOpsContext

    await openMessageThread(ctx, 'user-a', 'parent', 'anchor')

    expect(born[0]!.agents.map((agent) => agent.agentId)).toEqual(['qa'])
    expect(born[0]!.agents[0]!.modelId).toBe('qa-model')
    expect(seeded[0]!.payload.from).toBe('agent:qa')
  })
})
