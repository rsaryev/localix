import { describe, expect, test } from 'bun:test'

import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'
import { handleModelCommand } from './command-handlers-settings'

const models = [
  { id: 'openrouter/haiku', name: 'Haiku', providerId: 'openrouter' },
  { id: 'openrouter/sonnet', name: 'Sonnet', providerId: 'openrouter' },
]

async function run(prompt: string) {
  const replies: string[] = []
  const writes: unknown[] = []
  const session = sessionFixture({
    agents: routedParticipants({ modelId: 'openrouter/sonnet', reasoningEffort: 'medium' }),
  })
  const ctx = {
    deps: {
      db: {},
      catalogService: { getCatalog: async () => ({ providers: [{ id: 'openrouter' }], models }) },
    },
    repo: {
      updateSessionAgentRoute: async (...args: unknown[]) => void writes.push(args[3]),
      updateSession: async () => {},
    },
    runner: { leadership: () => async () => [] },
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
  return { replies, writes }
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
