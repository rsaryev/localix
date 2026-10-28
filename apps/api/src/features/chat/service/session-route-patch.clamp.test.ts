import { describe, expect, test } from 'bun:test'
import { clampRoutePatch } from './session-route-patch'

const session = {
  agent: {
    agentId: 'lead',
    providerConnectionId: 'conn-a',
    modelId: 'claude',
    reasoningEffort: 'high',
  },
} as never

const models: Record<string, { supportsReasoning?: boolean; reasoningEfforts?: string[] }> = {
  claude: { supportsReasoning: true, reasoningEfforts: ['low', 'medium', 'high'] },
  plain: { supportsReasoning: false },
}
const ctx = {
  reasoningModel: async (_userId: string, _connectionId: string | null, modelId: string) =>
    models[modelId] ?? null,
}

describe('clampRoutePatch', () => {
  test('a single pick stores a level its model offers', async () => {
    const patch = await clampRoutePatch(ctx, 'u', session, {
      route: {
        providerConnectionId: 'conn-a',
        modelId: 'claude',
        reasoningEffort: 'off',
      },
    })
    expect(patch.route?.reasoningEffort).toBe('low')
  })

  test('a level-only route is clamped against the session model', async () => {
    const patch = await clampRoutePatch(ctx, 'u', session, {
      route: { reasoningEffort: 'max' },
    })
    expect(patch.route?.reasoningEffort).toBe('high')
  })

  test('a level the session model does not offer is stored off', async () => {
    const plain = { agent: { ...(session as { agent: object }).agent, modelId: 'plain' } } as never
    const patch = await clampRoutePatch(ctx, 'u', plain, { route: { reasoningEffort: 'high' } })
    expect(patch.route?.reasoningEffort).toBe('off')
  })

  test('an unresolvable model keeps the stated level', async () => {
    const patch = await clampRoutePatch(ctx, 'u', session, {
      route: { modelId: 'unknown', reasoningEffort: 'max' },
    })
    expect(patch.route?.reasoningEffort).toBe('max')
  })
})
