import { describe, expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import { sessionExecutionContext } from '../execution-context'
import { dispatchParams } from '../run-params'
import { createConversationControlPort } from './conversation-control'
import { MAX_HANDOFF_CHAIN } from '../../turn-budget'

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

function harness(runParams = params) {
  let session = runParams.session
  const queued: string[] = []
  const scopes: Array<{ speakerAgentId: string; handoffDepth?: number }> = []
  const triggers: Array<readonly string[]> = []
  const published: unknown[] = []
  const notices: unknown[] = []
  const control = createConversationControlPort(
    {
      repo: {
        getSession: async () => session,
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
  )
  return {
    control,
    queued,
    scopes,
    triggers,
    published,
    notices,
    session: () => session,
  }
}

describe('conversation control port', () => {
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
    await expect(control.finish('remove', { remove: ['beta'], next: [] })).rejects.toThrow('fixed')
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

  test('invites and removes before scheduling the resulting party', async () => {
    const { control, queued, session, published } = harness()
    const result = await control.finish('changed', {
      invite: ['@qa'],
      remove: ['agent-b'],
      next: ['qa'],
    })

    expect(result).toEqual({ invited: ['@qa'], removed: ['@beta'], next: ['@qa'] })
    expect(session().agents.map((agent) => agent.handle)).toEqual(['alpha', 'qa'])
    expect(queued).toEqual(['agent-q'])
    // The change is announced in the conversation, the same way a composer edit is: without the
    // line, the others kept addressing the participant that had left.
    expect(published.map((args) => (args as [string, string, { type: string }])[2].type)).toEqual([
      'message.created',
      'session.updated',
    ])
  })

  test('an agent cannot remove the participant that is speaking', async () => {
    const speaking = createConversationControlPort(
      {
        repo: { getSession: async () => base } as never,
        enqueueRun: async () => {},
        deps: {
          listInvocableRegistryAgents: async () => [],
          streamRegistry: { publish: () => {} },
        },
        state: { activeRunSessions: new Map([[base.id, { agentId: 'agent-b' }]]) },
      } as never,
      params,
    )
    await expect(speaking.finish('remove-speaker', { remove: ['beta'], next: [] })).rejects.toThrow(
      'Stop the active agent',
    )
  })

  test('keeps at least one participant', async () => {
    const { control } = harness()
    await expect(
      control.finish('empty', {
        remove: ['alpha', 'beta'],
        next: [],
      }),
    ).rejects.toThrow('at least one')
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
