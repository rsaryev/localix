import { describe, expect, test } from 'bun:test'
import { clampRoutePatch } from './session-route-patch'

const session = {
  agents: [
    { agentId: 'lead', providerConnectionId: 'conn-a', modelId: 'claude', reasoningEffort: 'high' },
    { agentId: 'qa', providerConnectionId: 'conn-a', modelId: 'plain', reasoningEffort: 'off' },
  ],
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
        agentId: 'lead',
        providerConnectionId: 'conn-a',
        modelId: 'claude',
        reasoningEffort: 'off',
      },
    })
    expect(patch.route?.reasoningEffort).toBe('low')
  })

  test('a level-only route is clamped against the seat model', async () => {
    const patch = await clampRoutePatch(ctx, 'u', session, {
      route: { agentId: 'lead', reasoningEffort: 'max' },
    })
    expect(patch.route?.reasoningEffort).toBe('high')
  })

  test('a batch clamps every member, and a non-reasoning model stores off', async () => {
    const patch = await clampRoutePatch(ctx, 'u', session, {
      routes: [
        { agentId: 'lead', reasoningEffort: 'minimal' },
        { agentId: 'qa', reasoningEffort: 'high' },
      ],
    })
    expect(patch.routes?.map((route) => route.reasoningEffort)).toEqual(['low', 'off'])
  })

  test('an unresolvable model keeps the stated level', async () => {
    const patch = await clampRoutePatch(ctx, 'u', session, {
      route: { agentId: 'lead', modelId: 'unknown', reasoningEffort: 'max' },
    })
    expect(patch.route?.reasoningEffort).toBe('max')
  })
})
