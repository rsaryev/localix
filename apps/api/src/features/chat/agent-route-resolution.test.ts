import { describe, expect, test } from 'bun:test'
import { DEFAULT_REASONING_EFFORT } from '@localixai/agent'
import { birthRoute } from './agent-route-resolution'
import { rememberedEffort } from './service/session-route-defaults'

describe('birthRoute — the one decision of a new seat', () => {
  test('an explicit choice wins over every default', () => {
    const route = birthRoute({
      chosen: { modelId: 'picked/model', providerConnectionId: 'c1', reasoningEffort: 'max' },
      recentForAgent: { modelId: 'recent/model' },
      agent: { modelId: 'card/model', reasoningEffort: 'low' },
    })
    expect(route).toEqual({
      modelId: 'picked/model',
      providerConnectionId: 'c1',
      reasoningEffort: 'max',
      modelOrigin: 'session',
    })
  })

  test('the model falls to the card, your last pick, then the project — never another seat', () => {
    expect(birthRoute({ recentForAgent: { modelId: 'r' }, agent: { modelId: 'a' } }).modelId).toBe(
      'a',
    )
    expect(
      birthRoute({ recentForAgent: { modelId: 'r' }, project: { modelId: 'p' } }),
    ).toMatchObject({ modelId: 'r', modelOrigin: 'recent' })
    expect(birthRoute({ agent: { modelId: 'a' }, project: { modelId: 'p' } }).modelOrigin).toBe(
      'agent',
    )
    expect(birthRoute({ project: { modelId: 'p', providerConnectionId: 'c' } })).toMatchObject({
      modelId: 'p',
      providerConnectionId: 'c',
      modelOrigin: 'project',
    })
    expect(birthRoute({})).toMatchObject({ modelId: '', modelOrigin: 'unset' })
  })

  test('a last pick from a choice map brings its own level', () => {
    const route = birthRoute({
      recentForAgent: { modelId: 'haiku', reasoningEffort: 'low' },
      effortForModel: () => 'high',
    })
    expect(route).toMatchObject({ modelId: 'haiku', reasoningEffort: 'low', modelOrigin: 'recent' })
  })

  test('the effort is the level remembered for THAT model, never another seat’s', () => {
    const route = birthRoute({
      recentForAgent: { modelId: 'openai/a' },
      agent: { reasoningEffort: 'low' },
      effortForModel: (modelId) => (modelId === 'openai/a' ? 'high' : undefined),
    })
    expect(route.reasoningEffort).toBe('high')
  })

  test('with no memory the card, then the default — no clamp, no carry', () => {
    expect(birthRoute({ agent: { reasoningEffort: 'xhigh' } }).reasoningEffort).toBe('xhigh')
    expect(birthRoute({ project: { modelId: 'p' } }).reasoningEffort).toBe(DEFAULT_REASONING_EFFORT)
  })
})

describe('rememberedEffort', () => {
  test('reads one agent and model, preferring the entry of the model’s own provider', () => {
    const settings = [
      { agentId: 'a', providerId: 'openrouter', modelId: 'openai/m', effort: 'low' as const },
      { agentId: 'a', providerId: 'openai', modelId: 'openai/m', effort: 'max' as const },
      { agentId: 'b', providerId: 'openai', modelId: 'openai/m', effort: 'high' as const },
    ]
    expect(rememberedEffort(settings, 'a', 'openai/m')).toBe('max')
    expect(rememberedEffort(settings, 'c', 'openai/m')).toBeUndefined()
  })
})
