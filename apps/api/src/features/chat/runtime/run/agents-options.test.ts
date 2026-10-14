import { expect, test } from 'bun:test'
import { sessionFixture } from '../../../../testing/session-fixture'
import { CHAT_RUN_PROFILE, resolveRunProfile } from '../../../agent-core/run-shape'
import { createAgentsTool } from '../../../agent-core/tools/agents'
import { buildAgentsOptions } from './agents-options'
import type { RuntimeToolWiringContext, buildRunToolRegistry } from './runtime-tools'
import { routeConversationReply } from './conversation-routing'
import { dispatchParams } from '../run-params'
import { sessionExecutionContext } from '../execution-context'

test('host binds creation to the speaker and registry, then a handoff invites and schedules it', async () => {
  const actor = {
    agentId: 'builtin:localix',
    handle: 'localix',
    providerConnectionId: null,
    modelId: '',
    reasoningEffort: 'high' as const,
  }
  let session = sessionFixture({ projectId: 'p', agents: [actor] })
  const created = {
    record: {
      id: 'native:reviewer',
      handle: 'migration-reviewer',
      description: 'Reviews',
      instructions: 'Review.',
      leadershipPriority: 0,
    },
    enabled: true,
    invocations: { chat: 'allow' },
    scope: 'project' as const,
    projectId: 'p',
    source: 'local',
    path: '',
    builtin: false,
  }
  const origins: unknown[] = []
  const queued: string[] = []
  let published = 0
  let saved = false
  const service = {
    listAgents: async () => (saved ? [created] : []),
    getAgent: async () => (saved ? created : null),
    createAgentsFromAgent: async (_u: string, _input: unknown, origin: unknown) => {
      origins.push(origin)
      saved = true
      return { created: [created], errors: [] }
    },
  }
  const ctx = {
    deps: { agentManagement: service, announceCapabilityChange: () => published++ },
  } as unknown as RuntimeToolWiringContext
  const params = {
    userId: session.userId,
    agentId: actor.agentId,
    session,
    agentProfile: CHAT_RUN_PROFILE,
    currentMessageId: () => 'reply-1',
  } as Parameters<typeof buildRunToolRegistry>[1]
  const port = buildAgentsOptions(ctx, params)!
  const tool = createAgentsTool(port)
  await tool.execute('call-1', {
    action: 'create',
    agents: [
      {
        handle: created.record.handle,
        description: 'Reviews',
        instructions: 'Review.',
        leadership_priority: 0,
      },
    ],
  })
  expect(origins).toEqual([
    {
      agentId: actor.agentId,
      projectId: 'p',
      sessionId: session.id,
      operationId: 'reply-1:call-1',
    },
  ])
  expect(published).toBe(1)
  expect(session.agents).toHaveLength(1)
  expect(queued).toEqual([])

  // The creator hands the new agent the floor: the host invites it and hands it the floor.
  await routeConversationReply(
    {
      repo: {
        getSession: async () => session,
        updateMembership: async (_u: string, _id: string, agents: typeof session.agents) => {
          session = { ...session, agents }
          return true
        },
        insertMessage: async () => {},
      },
      deps: {
        listInvocableRegistryAgents: async () =>
          saved
            ? [{ agentId: created.record.id, name: created.record.handle, description: 'Reviews' }]
            : [],
        streamRegistry: { publish: () => {} },
      },
      enqueueRun: async (request: { scope: { speakerAgentId: string } }) => {
        queued.push(request.scope.speakerAgentId)
      },
    } as never,
    dispatchParams(
      { userId: session.userId, session, assistantMessageId: 'reply-1', historyMessages: [] },
      { speakerAgentId: actor.agentId, executionContext: sessionExecutionContext(session) },
    ),
    {
      content: `Review the migration and report compatibility issues.`,
      handoffs: [created.record.handle],
    },
  )
  expect(session.agents).toHaveLength(2)
  expect(queued).toEqual([created.record.id])
})

test('child, automation and non-root hosts never acquire registry authoring', () => {
  const ctx = { deps: { agentManagement: {} } } as unknown as RuntimeToolWiringContext
  for (const sessionKind of ['subagent', 'job', 'chat'] as const) {
    const session = sessionFixture({ sessionKind })
    const params = {
      session: { ...session, provenance: { kind: 'delegated' } },
      agentProfile: resolveRunProfile({ sessionKind }),
    } as unknown as Parameters<typeof buildRunToolRegistry>[1]
    expect(buildAgentsOptions(ctx, params)).toBeUndefined()
  }
})
