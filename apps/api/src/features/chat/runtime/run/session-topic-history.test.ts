import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createDatabase, destroyDatabase } from '../../../../db/connection'
import { migrateToLatest } from '../../../../db/migrator'
import { agentParticipant } from '../../../../db/participant'
import { sessionFixture } from '../../../../testing/session-fixture'
import { testWork } from '../../../../testing/work-fixture'
import { createChatRepository } from '../../repository'
import type { PersistedMessage } from '../../contracts'
import { createModelContextRepository } from '../../model-context-repository'
import { systemNoticeBinding } from '../../system-notice-bindings'
import { historyAfterBoundary, loadModelView } from '../model-view/view'
import { createChatHistoryRun } from '../history/chat-strategy'
import { bareFrame, freshLane, TEST_IDENTITY } from '../history/test-fixtures'
import { resolveContextBudgetFrame } from '../context-budget'
import { createRuntimeState } from '../agent-runner-state'
import { dispatchParams, reenterParams } from '../run-params'
import { sessionExecutionContext } from '../execution-context'
import { admitRun } from './stages/admit'
import type { RunEnv } from './types'
import { buildSessionTopicSection } from '../../../agent-core/session-topic'
import { buildTurnTriggerContext } from './turn-trigger-context'

describe('topic change starts a fresh model context', () => {
  let db: ReturnType<typeof createDatabase>
  let repo: ReturnType<typeof createChatRepository>
  const session = sessionFixture({
    agents: ['lead', 'qa'].map((agentId) => ({
      agentId,
      handle: agentId,
      modelId: '',
      providerConnectionId: null,
      reasoningEffort: 'medium',
    })),
  })
  const boundary = { messageId: 'topic-host', agentId: 'lead' }
  const topic = {
    title: 'Release',
    goal: 'Deploy the parser.',
    previousTopicSummary: 'Tests passed. Keep Bun.',
  }
  const row = (id: string, payload: PersistedMessage['payload']): PersistedMessage => ({
    id,
    payload,
    userId: session.userId,
    sessionId: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  })

  beforeEach(async () => {
    db = createDatabase()
    await migrateToLatest(db)
    repo = createChatRepository(db)
    await repo.insertSession(session)
    await repo.insertMessage(
      row('old-user', {
        id: 'old-user',
        role: 'user',
        from: 'user',
        content: 'OLD_USER_CONTEXT',
        pinned: true,
      }),
    )
    for (const agent of session.agents) {
      const id = `old-${agent.agentId}`
      await repo.insertMessage(
        row(id, {
          id,
          role: 'assistant',
          from: agentParticipant(agent.agentId),
          content: 'OLD_PUBLIC_REPLY',
          usage: { contextTokens: 100_000 },
          items: [
            { type: 'reasoning', id: 'reasoning', text: 'OLD_REASONING' },
            {
              type: 'tool_call',
              id: 'read',
              toolCallId: `read-${agent.agentId}`,
              name: 'read',
              status: 'completed',
              input: { path: '/tmp/old' },
              resultText: 'OLD_TOOL_RESULT',
            },
          ],
        }),
      )
      await createModelContextRepository(db).write({
        sessionId: session.id,
        messageId: id,
        now: session.updatedAt,
        turnContext: {
          full: true,
          content: 'OLD_SYSTEM_MESSAGE',
          changes: { 'old-context': 'OLD_SYSTEM_MESSAGE' },
        },
        checkpoint: {
          version: 1,
          reason: 'threshold',
          coversThroughId: id,
          evictedThroughId: 'old-user',
          cards: [],
          transforms: {},
          pinnedIds: ['old-user'],
          recoveryToolAvailable: true,
          recallToolAvailable: true,
          tokens: { before: 100_000, after: 1_000, target: 2_000 },
        },
      })
    }
    await repo.insertMessage(
      row(boundary.messageId, {
        id: boundary.messageId,
        role: 'assistant',
        from: agentParticipant('lead'),
        content: 'OLD_TOPIC_HANDOFF',
        items: [
          {
            type: 'tool_call',
            id: 'topic-control',
            name: 'conversation_control',
            input: { next: ['qa'], topic },
            status: 'completed',
          },
        ],
      }),
    )
    expect(
      await repo.updateSessionTopic(
        session.userId,
        session.id,
        session,
        topic,
        session.updatedAt,
        boundary,
      ),
    ).toBe(true)
  })

  afterEach(async () => {
    await destroyDatabase(db)
  })

  test('solo and group participants receive only new history and the saved summary, even after restart', async () => {
    await repo.insertMessage(
      row('new-user', { id: 'new-user', role: 'user', from: 'user', content: 'NEW_TOPIC_CONTEXT' }),
    )
    // A fresh repository and lane simulate a restart; the boundary lives in the database.
    const restarted = createChatRepository(db)
    const raw = await restarted.listMessages(session.userId, session.id)
    expect(raw.map((m) => m.id)).toContain('old-user')
    expect(raw.map((m) => m.id)).toContain(boundary.messageId)
    expect(
      (await restarted.getMessage(session.userId, session.id, boundary.messageId))?.payload.content,
    ).toBe('OLD_TOPIC_HANDOFF')
    const shared = (await restarted.getSession(session.userId, session.id))!
    const system = buildSessionTopicSection(shared)
    expect(system).toContain(topic.goal)
    expect(system).toContain(topic.previousTopicSummary)
    for (const agents of [session.agents, [session.agents[0]!]]) {
      for (const agent of agents) {
        const view = await loadModelView(createModelContextRepository(db), {
          sessionId: session.id,
          viewer: agentParticipant(agent.agentId),
          historyMessages: raw,
          currentMessageId: `next-${agent.agentId}`,
          contextWindow: 32_000,
        })
        expect(view.epochId).toBe(boundary.messageId)
        expect(view.checkpoint).toBeUndefined()
        expect(view.previous).toBeUndefined()
        expect(view.due).toBeUndefined()
        expect(view.turnContexts.size).toBe(0)
        const run = createChatHistoryRun({
          sessionId: session.id,
          view,
          identity: TEST_IDENTITY,
          state: freshLane(),
          media: {},
          frame: resolveContextBudgetFrame({ contextWindow: 32_000 }),
          participantAudience: {
            viewer: agentParticipant(agent.agentId),
            tools: new Set(['read', 'conversation_control']),
          },
        })
        const output = await run.materialize(
          bareFrame(raw, 'new-user'),
          new AbortController().signal,
        )
        expect(output.effectiveHistory.map((m) => m.id)).toEqual(['new-user'])
        expect(JSON.stringify(output.wire)).toContain('NEW_TOPIC_CONTEXT')
        expect(JSON.stringify(output.wire)).not.toContain('OLD_')
        expect(output.identity.boundaryId).toBe(boundary.messageId)
      }
    }
  })

  test('admission removes old notices before hooks and prompt assembly and carries the new epoch through retries', async () => {
    const notice = { kind: 'model_change' as const, tone: 'neutral' as const, text: 'NEW_NOTICE' }
    await repo.insertMessage(
      row('new-notice', {
        id: 'new-notice',
        role: 'user',
        from: 'system',
        content: notice.text,
        uiOnly: true,
        systemNotice: notice,
        bindings: [systemNoticeBinding(notice, 'new-notice', session.createdAt)],
      }),
    )
    const history = await repo.listMessages(session.userId, session.id)
    const state = createRuntimeState(testWork(db))
    const env = {
      repo,
      state,
      deps: { streamRegistry: { publish: () => {} } },
      markRuntimeSessionStatus: async (_userId: string, current: typeof session) => current,
    } as unknown as RunEnv
    const params = dispatchParams(
      {
        userId: session.userId,
        session,
        historyMessages: history,
        assistantMessageId: 'next',
      },
      {
        speakerAgentId: 'lead',
        executionContext: sessionExecutionContext(session),
        turnTrigger: { kind: 'colleague-request', messageIds: [boundary.messageId] },
      },
    )
    const frame = await admitRun(env, params, () => {})
    expect(frame.params.historyMessages.map((m) => m.id)).toEqual(['new-notice'])
    expect(frame.params.contextBoundaryId).toBe(boundary.messageId)
    expect(params.historyMessages.length).toBeGreaterThan(1)
    const retry = reenterParams(frame.params, {}, { transientRetryCount: 1 })
    const view = await loadModelView(createModelContextRepository(db), {
      sessionId: session.id,
      viewer: agentParticipant('lead'),
      historyMessages: retry.historyMessages,
      currentMessageId: 'retry',
      contextBoundaryId: retry.contextBoundaryId,
    })
    expect(view.epochId).toBe(boundary.messageId)
    const trigger = buildTurnTriggerContext(
      params.scope,
      session,
      frame.params.historyMessages,
      boundary.messageId,
    )
    expect(trigger).toContain('goal in the system prompt')
    expect(trigger).not.toContain('earlier human message remains context')
    expect(historyAfterBoundary(history).rows.map((m) => m.id)).toEqual(['new-notice'])
  })
})
