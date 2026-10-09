import { describe, expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import { sessionExecutionContext } from '../execution-context'
import { dispatchParams } from '../run-params'
import { createConversationControlPort } from './conversation-control'
import { MAX_HANDOFF_CHAIN } from '../../turn-budget'
import type { SessionTopic } from '../../../agent-core/session-topic'

const base = sessionFixture({
  agents: [
    {
      agentId: 'agent-a',
      handle: 'alpha',
      providerConnectionId: null,
      modelId: '',
      reasoningEffort: 'medium',
    },
    {
      agentId: 'agent-b',
      handle: 'beta',
      providerConnectionId: null,
      modelId: '',
      reasoningEffort: 'medium',
    },
  ],
})

const params = dispatchParams(
  {
    userId: base.userId,
    session: base,
    assistantMessageId: 'reply-a',
    historyMessages: [],
  },
  {
    speakerAgentId: 'agent-a',
    executionContext: sessionExecutionContext(base),
  },
)

function harness(runParams = params, currentMessageId?: () => string) {
  let session = runParams.session
  const queued: string[] = []
  const scopes: Array<{ speakerAgentId: string; handoffDepth?: number }> = []
  const triggers: Array<readonly string[]> = []
  const published: unknown[] = []
  const notices: unknown[] = []
  const boundaries: unknown[] = []
  const control = createConversationControlPort(
    {
      repo: {
        getSession: async () => session,
        updateSessionTopic: async (
          _u: string,
          _id: string,
          expected: typeof session,
          topic: SessionTopic,
          _updatedAt: string,
          boundary: { messageId: string; agentId: string },
        ) => {
          if (
            expected.goal !== session.goal ||
            expected.previousTopicSummary !== session.previousTopicSummary
          )
            return false
          session = { ...session, ...topic }
          boundaries.push(boundary)
          return true
        },
        updateMembership: async (
          _userId: string,
          _sessionId: string,
          agents: typeof session.agents,
        ) => {
          session = { ...session, agents }
          return true
        },
        insertMessage: async (message: unknown) => {
          notices.push(message)
        },
      },
      enqueueRun: async (next: {
        triggerMessageIds: readonly string[]
        scope: { speakerAgentId: string; handoffDepth?: number }
      }) => {
        queued.push(next.scope.speakerAgentId)
        scopes.push(next.scope)
        triggers.push(next.triggerMessageIds)
      },
      deps: {
        listRegistryAgents: async () => [
          { agentId: 'agent-a', leadershipPriority: 100 },
          { agentId: 'agent-b', leadershipPriority: 40 },
        ],
        listInvocableRegistryAgents: async () => [
          {
            agentId: 'agent-a',
            name: 'alpha',
            description: 'Lead',
            leadershipPriority: 100,
          },
          {
            agentId: 'agent-b',
            name: 'beta',
            description: 'Backend',
            leadershipPriority: 40,
          },
          {
            agentId: 'agent-q',
            name: 'qa',
            description: 'Quality',
            leadershipPriority: 20,
          },
        ],
        streamRegistry: { publish: (...args: unknown[]) => published.push(args) },
      },
    } as never,
    runParams,
    currentMessageId,
  )
  return {
    control,
    queued,
    scopes,
    triggers,
    published,
    notices,
    boundaries,
    session: () => session,
    setSession: (next: typeof session) => {
      session = next
    },
  }
}

describe('conversation control port', () => {
  const topic = {
    title: 'Release',
    goal: 'Ship the verified parser.',
    previousTopicSummary: 'Parser fixed; tests passed. Keep Bun; review deployment next.',
  }

  test('the leader publishes session state and hands off without publishing tool history', async () => {
    const h = harness()
    await h.control.finish('topic', { next: ['beta'], topic })
    expect(h.session()).toMatchObject(topic)
    expect(h.queued).toEqual(['agent-b'])
    expect(h.notices).toEqual([])
    expect(h.published).toEqual([
      [
        base.userId,
        base.id,
        {
          type: 'session.updated',
          session: expect.objectContaining(topic),
        },
      ],
      [
        base.userId,
        base.id,
        { type: 'session_model_view.updated', sessionId: base.id, modelView: null },
      ],
    ])
  })

  test('a fixed solo chat changes its topic without inviting or scheduling anyone', async () => {
    const h = harness({
      ...params,
      session: { ...base, agents: [base.agents[0]!], rosterLocked: true },
    })
    await h.control.finish('topic', { next: [], topic })
    expect(h.session()).toMatchObject({ ...topic, rosterLocked: true })
    expect(h.queued).toEqual([])
    expect(h.control.completed()).toBe(true)
  })

  test('after a steer split the current assistant row starts the topic and anchors the next run', async () => {
    const h = harness(params, () => 'steered-reply')
    await h.control.finish('topic', { topic, next: ['beta'] })
    expect(h.boundaries).toEqual([{ messageId: 'steered-reply', agentId: 'agent-a' }])
    expect(h.triggers).toEqual([['steered-reply']])
  })

  test('a topic change can continue in a fresh solo run; ordinary calls cannot self-schedule', async () => {
    const h = harness({
      ...params,
      session: { ...base, agents: [base.agents[0]!], rosterLocked: true },
    })
    await expect(h.control.finish('loop', { next: ['alpha'] })).rejects.toThrow(
      'cannot schedule itself',
    )
    expect(h.queued).toEqual([])
    await h.control.finish('topic', { next: ['alpha'], topic })
    expect(h.queued).toEqual(['agent-a'])
    expect(h.session()).toMatchObject(topic)
    expect(h.triggers).toEqual([['reply-a']])
  })

  test('a specialist cannot change the topic', async () => {
    const h = harness({ ...params, scope: { ...params.scope, speakerAgentId: 'agent-b' } })
    await expect(h.control.finish('topic', { next: [], topic })).rejects.toThrow('leader')
    expect(h.session()).toEqual(base)
    expect(h.published).toEqual([])
    expect(h.control.completed()).toBe(false)
  })

  test('leadership follows registry priority rather than the order participants joined', async () => {
    const h = harness({ ...params, session: { ...base, agents: [...base.agents].reverse() } })
    await h.control.finish('topic', { next: [], topic })
    expect(h.session()).toMatchObject(topic)
  })

  test('a run with an outdated objective cannot erase a newer topic', async () => {
    const h = harness()
    h.setSession({ ...base, goal: 'Newer goal', previousTopicSummary: 'Newer decisions' })
    await expect(h.control.finish('topic', { next: [], topic })).rejects.toThrow(
      'changed during this turn',
    )
    expect(h.session().goal).toBe('Newer goal')
    expect(h.published).toEqual([])
    expect(h.control.completed()).toBe(false)
  })

  test('a delegated team cannot change a chat topic', async () => {
    const h = harness({ ...params, session: { ...base, sessionKind: 'subagent' } })
    await expect(h.control.finish('topic', { next: [], topic })).rejects.toThrow('Only chat')
    expect(h.published).toEqual([])
  })

  test('incomplete summaries and invalid next speakers never update the topic', async () => {
    const h = harness()
    await expect(
      h.control.finish('topic', { next: [], topic: { ...topic, previousTopicSummary: '' } }),
    ).rejects.toThrow()
    await expect(h.control.finish('topic', { next: ['missing'], topic })).rejects.toThrow(
      'unavailable',
    )
    expect(h.session()).toEqual(base)
    expect(h.published).toEqual([])
  })
  test('a solo chat invites help, receives a report and concludes in the same session', async () => {
    const solo = { ...base, agents: [base.agents[0]!] }
    const first = harness({ ...params, session: solo })
    await first.control.finish('invite-qa', { invite: ['qa'], next: ['qa'] })
    expect(first.queued).toEqual(['agent-q'])
    expect(first.session().id).toBe(solo.id)
    const report = harness({
      ...params,
      session: first.session(),
      assistantMessageId: 'reply-qa',
      scope: { ...params.scope, speakerAgentId: 'agent-q', handoffDepth: 1 },
    })
    await report.control.finish('report', { next: ['alpha'] })
    expect(report.queued).toEqual(['agent-a'])
    expect(report.triggers).toEqual([['reply-qa']])
    expect(report.scopes).toMatchObject([{ handoffDepth: 2 }])
    const done = harness({ ...params, session: report.session() })
    await done.control.finish('done', { next: [] })
    expect(done.queued).toEqual([])
  })
  test('a delegated team hands off through the same queue without changing its roster', async () => {
    const child = sessionFixture({ ...base, sessionKind: 'subagent', parentSessionId: 'parent' })
    const { control, queued, scopes, published } = harness({ ...params, session: child })
    expect(await control.finish('handoff', { next: ['beta'] })).toEqual({
      invited: [],
      removed: [],
      next: ['@beta'],
    })
    expect(queued).toEqual(['agent-b'])
    expect(scopes).toMatchObject([{ speakerAgentId: 'agent-b', handoffDepth: 1 }])
    expect(published).toEqual([])
  })

  test('a delegated team cannot invite, remove, or schedule agents outside its roster', async () => {
    const child = sessionFixture({ ...base, sessionKind: 'subagent', parentSessionId: 'parent' })
    const { control, queued } = harness({ ...params, session: child })
    await expect(control.finish('invite', { invite: ['qa'], next: [] })).rejects.toThrow('fixed')
    await expect(
      control.finish('remove', { remove: ['beta'], next: [] } as never),
    ).rejects.toThrow()
    await expect(control.finish('outsider', { next: ['qa'] })).rejects.toThrow('unavailable')
    expect(queued).toEqual([])
    expect(control.completed()).toBe(false)
    expect(await control.finish('done', { next: [] })).toEqual({
      invited: [],
      removed: [],
      next: [],
    })
  })

  test('invite with next:[] only changes membership; it must not implicitly start work', async () => {
    const { control, queued, session } = harness()
    const result = await control.finish('invite-only', {
      invite: ['@qa'],
      next: [],
    })
    expect(result).toEqual({ invited: ['@qa'], removed: [], next: [] })
    expect(session().agents.map((agent) => agent.handle)).toContain('qa')
    expect(queued).toEqual([])
    expect(control.completed()).toBe(true)
  })

  test('invite with explicit next starts only the selected colleague, not the whole team', async () => {
    const { control, queued } = harness()
    await control.finish('handoff', {
      invite: ['@beta', '@qa'],
      next: ['beta'],
    })
    expect(queued).toEqual(['agent-b'])
  })

  test('a handoff is anchored by the handing-off reply, whatever the run history holds', async () => {
    // The run's history is empty here, so the old "last history row" fallback had nothing to
    // name; the colleague's reply must still answer the turn that handed it the floor.
    const { control, triggers } = harness()
    await control.finish('handoff', { next: ['beta'] })
    expect(triggers).toEqual([['reply-a']])
  })

  test('schedules a current colleague once and completes once', async () => {
    const { control, queued } = harness()
    const result = await control.finish('accepted', {
      next: ['@beta', 'beta'],
    })
    expect(result.next).toEqual(['@beta'])
    expect(queued).toEqual(['agent-b'])
    expect(control.completed()).toBe(true)
    await expect(control.finish('duplicate', { next: [] })).rejects.toThrow('only once')
  })

  test('no agent can remove anyone, including an idle participant or itself', async () => {
    for (const remove of [['beta'], ['alpha'], [], ['alpha', 'beta']]) {
      const h = harness()
      await expect(
        h.control.finish('remove', { invite: ['qa'], remove, next: ['qa'] } as never),
      ).rejects.toThrow()
      expect(h.session()).toEqual(base)
      expect(h.published).toEqual([])
      expect(h.queued).toEqual([])
      expect(h.control.completed()).toBe(false)
    }
  })

  test('does not persist membership when the requested next participant is invalid', async () => {
    const { control, session, published } = harness()
    await expect(
      control.finish('invalid-next', {
        invite: ['qa'],
        next: ['missing'],
      }),
    ).rejects.toThrow('Available:')
    expect(session().agents.map((agent) => agent.handle)).toEqual(['alpha', 'beta'])
    expect(published).toHaveLength(0)
  })

  test('each handoff counts one hop further from the person', async () => {
    const { control, scopes } = harness()
    await control.finish('hop', { next: ['beta'] })
    expect(scopes).toMatchObject([{ speakerAgentId: 'agent-b', handoffDepth: 1 }])
  })

  test('past the bound nobody is queued and the person is told the floor is theirs', async () => {
    const atBound = { ...params, scope: { ...params.scope, handoffDepth: MAX_HANDOFF_CHAIN } }
    const { control, queued, notices } = harness(atBound)
    const result = await control.finish('hop', { next: ['beta'] })
    expect(queued).toEqual([])
    expect(result.next).toEqual([])
    expect(result.stopped).toContain('Handoff limit')
    expect(notices).toMatchObject([
      { id: 'reply-a:handoff-limit', payload: { systemNotice: { kind: 'handoff_limit' } } },
    ])
  })
})
