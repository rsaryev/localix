import { describe, expect, test } from 'bun:test'

import type { StoredSystemNotice } from '../../../db/payload'
import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'
import { handleModelCommand, uniqueCatalogModelProvider } from './command-handlers-settings'

const providers = [{ id: 'provider-a' }, { id: 'provider-b' }]

describe('uniqueCatalogModelProvider', () => {
  test('recovers a deleted connection only when the stored model has one owner', () => {
    expect(
      uniqueCatalogModelProvider(
        providers,
        [{ id: 'provider-a/unique', providerId: 'provider-a' }],
        'provider-a/unique',
      ),
    ).toBe('provider-a')
  })

  test('fails closed for an ambiguous or unknown bare model id', () => {
    const models = [
      { id: 'shared', providerId: 'provider-a' },
      { id: 'shared', providerId: 'provider-b' },
    ]
    expect(uniqueCatalogModelProvider(providers, models, 'shared')).toBeNull()
    expect(uniqueCatalogModelProvider(providers, models, 'missing')).toBeNull()
  })
})

describe('/model', () => {
  const run = async (reasoningEffort: 'xhigh' | 'medium') => {
    const notices: StoredSystemNotice[] = []
    const writes: unknown[] = []
    const session = sessionFixture({
      agents: routedParticipants({ modelId: 'openai/strong', reasoningEffort }),
    })
    const ctx = {
      deps: {
        // A failed settings read degrades to "nothing remembered".
        db: {},
        catalogService: {
          getCatalog: async () => ({
            providers: [{ id: 'openrouter' }],
            models: [{ id: 'openrouter/haiku', name: 'Haiku', providerId: 'openrouter' }],
          }),
        },
      },
      repo: {
        updateSessionAgentRoutes: async (...args: unknown[]) => {
          const [{ agentId: _agentId, ...route }] = args[2] as [{ agentId: string }]
          writes.push(route)
        },
        updateSession: async () => {},
      },
      runner: { leadership: () => async () => [] },
      publishSession: () => {},
      insertSystemNotice: async (_u: string, sessionId: string, notice: StoredSystemNotice) => {
        notices.push(notice)
        return { sessionId, messageId: `m${notices.length}` }
      },
    }
    await handleModelCommand(
      ctx as never,
      session.userId,
      session.id,
      session,
      [],
      '/model haiku',
      '2026-01-01T00:00:00.000Z',
      () => Promise.reject(new Error('no reply expected')),
    )
    return { notices, writes }
  }

  test('a level reset by the switch is announced, so no stale level line outlives it', async () => {
    const { notices, writes } = await run('xhigh')
    expect(writes).toEqual([{ modelId: 'openrouter/haiku', reasoningEffort: 'medium' }])
    expect(notices.map((notice) => notice.kind)).toEqual(['model_change', 'reasoning_change'])
    expect(notices[1]?.text).toBe('localix reasoning effort set to medium.')
  })

  test('an unchanged level adds no second line', async () => {
    const { notices } = await run('medium')
    expect(notices.map((notice) => notice.kind)).toEqual(['model_change'])
  })
})
