import { describe, expect, test } from 'bun:test'

import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'
import { handleModelCommand } from './command-handlers-settings'
import { INERT_CC_HOOKS, type CcHooksRuntime } from '../../cc-hooks'
import { createCcHookSessions } from '../runtime/cc-hook-sessions'

const models = [
  { id: 'openrouter/haiku', name: 'Haiku', providerId: 'openrouter' },
  { id: 'openrouter/sonnet', name: 'Sonnet', providerId: 'openrouter' },
]

async function run(prompt: string, hooks?: Partial<CcHooksRuntime>) {
  const replies: string[] = []
  const ccHookSessions = createCcHookSessions()
  if (hooks)
    ccHookSessions.runtimeFor = () => ({
      ...INERT_CC_HOOKS,
      active: true,
      hasHooks: () => true,
      ...hooks,
    })
  const writes: unknown[] = []
  const session = sessionFixture({
    agents: routedParticipants({ modelId: 'openrouter/sonnet', reasoningEffort: 'medium' }),
  })
  const ctx = {
    deps: {
      ports: { userProfileRepo: {} },
      catalogService: { getCatalog: async () => ({ providers: [{ id: 'openrouter' }], models }) },
    },
    repo: {
      updateSessionAgentRoutes: async (...args: unknown[]) => {
        const [{ agentId: _agentId, ...route }] = args[2] as [{ agentId: string }]
        writes.push(route)
      },
      updateSession: async () => {},
    },
    runner: { leadership: () => async () => [], ccHookSessions },
    publishSession: () => {},
    insertSystemNotice: async (_u: string, sessionId: string) => ({ sessionId, messageId: 'm' }),
  }
  await handleModelCommand(
    ctx as never,
    session.userId,
    session.id,
    session,
    [],
    prompt,
    '2026-01-01T00:00:00.000Z',
    async (text) => {
      replies.push(text)
      return { sessionId: session.id, messageId: 'reply' } as never
    },
  )
  return { replies, writes, ccHookSessions }
}

describe('/model never dumps the catalog', () => {
  test('bare /model points at the steps instead of listing models', async () => {
    const { replies, writes } = await run('/model')
    expect(writes).toEqual([])
    expect(replies).toHaveLength(1)
    expect(replies[0]).not.toContain('Available models')
    expect(replies[0]).not.toContain('Haiku')
    expect(replies[0]).toContain('/model <name>')
  })

  test('/model <name> still switches the participant directly', async () => {
    const { replies, writes } = await run('/model haiku')
    expect(replies).toEqual([])
    expect(writes).toEqual([{ modelId: 'openrouter/haiku', reasoningEffort: 'medium' }])
  })

  test('an unknown name explains where to pick instead of listing', async () => {
    const { replies } = await run('/model nothing-like-it')
    expect(replies[0]).toContain('No model matching')
    expect(replies[0]).not.toContain('Available models')
  })
})

describe('/model and the model-switch hooks', () => {
  test('a PreModelSwitch deny keeps the model and says why', async () => {
    const asked: unknown[] = []
    const { replies, writes } = await run('/model haiku', {
      runPreModelSwitch: async (change) => {
        asked.push(change)
        return { decision: 'deny', reason: 'Haiku is not allowed here' }
      },
    })
    expect(asked).toEqual([
      {
        fromModel: 'openrouter/sonnet',
        toModel: 'openrouter/haiku',
        requestedModel: 'haiku',
        source: 'command',
      },
    ])
    expect(writes).toEqual([])
    expect(replies[0]).toContain('Haiku is not allowed here')
  })

  test('a switch that goes ahead fires PostModelSwitch after the write', async () => {
    const after: string[] = []
    const { writes } = await run('/model haiku', {
      runPostModelSwitch: async (change) => {
        after.push(change.toModel)
        return {}
      },
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(writes).toHaveLength(1)
    expect(after).toEqual(['openrouter/haiku'])
  })
})
