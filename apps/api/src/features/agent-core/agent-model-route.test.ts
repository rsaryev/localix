import { describe, expect, test } from 'bun:test'

import { agentModelRoute } from './agent-model-route'

/**
 * The ONE answer to "which model and effort does this agent run on": an agent file's `model` and
 * `effort` (and the `localix.model` route Claude Code cannot run) against the catalog and, when a
 * chat asks, the chat's provider. Claude Code's rules, on Localix's routes.
 */
const chat = { providerId: 'anthropic', connectionId: 'conn-1', modelId: 'claude-opus-4-8' }
const catalog = [
  { id: 'claude-haiku-4-5', providerId: 'anthropic' },
  { id: 'claude-3-5-haiku', providerId: 'anthropic' },
  { id: 'claude-sonnet-5', providerId: 'anthropic' },
  { id: 'claude-opus-4-8', providerId: 'anthropic' },
  { id: 'gpt-6-luna', providerId: 'openai' },
]

describe('in a chat', () => {
  test('an alias resolves to the newest of its family on the chat’s provider and connection', () => {
    expect(agentModelRoute({ model: 'haiku' }, { chat, catalog })).toEqual({
      route: { providerConnectionId: 'conn-1', modelId: 'claude-haiku-4-5' },
      notes: [],
    })
    expect(agentModelRoute({ model: 'Sonnet' }, { chat, catalog }).route.modelId).toBe(
      'claude-sonnet-5',
    )
  })

  // sub-agents.md: with the main conversation on that family, an alias keeps its exact model.
  test('an alias of the chat’s own family keeps the chat’s exact model', () => {
    const big = { ...chat, modelId: 'claude-opus-4-8[1m]' }
    const offered = [...catalog, { id: 'claude-opus-5-0', providerId: 'anthropic' }]
    expect(agentModelRoute({ model: 'opus' }, { chat: big, catalog: offered }).route.modelId).toBe(
      'claude-opus-4-8[1m]',
    )
  })

  test('a catalog that spells ids with their provider resolves the same way', () => {
    const prefixed = catalog.map((model) => ({
      ...model,
      id: `${model.providerId}/${model.id}`,
    }))
    expect(agentModelRoute({ model: 'sonnet' }, { chat, catalog: prefixed }).route).toEqual({
      providerConnectionId: 'conn-1',
      modelId: 'claude-sonnet-5',
    })
  })

  test('a concrete id the provider offers is used; one it does not is noted and inherited', () => {
    expect(agentModelRoute({ model: 'claude-sonnet-5' }, { chat, catalog }).route).toEqual({
      providerConnectionId: 'conn-1',
      modelId: 'claude-sonnet-5',
    })
    const elsewhere = agentModelRoute({ model: 'gpt-6-luna' }, { chat, catalog })
    expect(elsewhere.route).toEqual({})
    expect(elsewhere.notes[0]).toContain('runs on claude-opus-4-8')
    expect(agentModelRoute({ model: 'inherit' }, { chat, catalog })).toEqual({
      route: {},
      notes: [],
    })
  })

  test('the localix route wins over the file’s model, and names its own provider', () => {
    const asked = { model: 'haiku', route: 'openai/gpt-6-luna' }
    expect(agentModelRoute(asked, { chat, catalog })).toEqual({
      // The route's provider is not the chat's: the run finds a live connection for it.
      route: { providerConnectionId: null, modelId: 'openai/gpt-6-luna' },
      notes: [],
    })
    expect(
      agentModelRoute({ route: 'anthropic/claude-sonnet-5' }, { chat, catalog }).route,
    ).toEqual({ providerConnectionId: 'conn-1', modelId: 'claude-sonnet-5' })
  })

  test('effort becomes a reasoning level; an unknown word inherits and says so', () => {
    expect(agentModelRoute({ effort: 'xhigh' }, { chat, catalog }).route).toEqual({
      reasoningEffort: 'xhigh',
    })
    const unknown = agentModelRoute({ effort: 'extreme' }, { chat, catalog })
    expect(unknown.route).toEqual({})
    expect(unknown.notes[0]).toContain('not a reasoning level')
  })
})

describe('without a chat (a seat’s starting route)', () => {
  test('a concrete model is spelled with its provider and left to find a live connection', () => {
    expect(
      agentModelRoute({ route: 'anthropic/claude-sonnet-5', effort: 'high' }, {}).route,
    ).toEqual({
      modelId: 'anthropic/claude-sonnet-5',
      providerConnectionId: null,
      reasoningEffort: 'high',
    })
    expect(agentModelRoute({ model: 'gpt-6-luna' }, {}).route).toEqual({
      modelId: 'gpt-6-luna',
      providerConnectionId: null,
    })
  })

  test('an alias or inherit means nothing here: the run resolves it where it has a chat', () => {
    expect(agentModelRoute({ model: 'opus' }, {})).toEqual({ route: {}, notes: [] })
    expect(agentModelRoute({ model: 'inherit' }, {})).toEqual({ route: {}, notes: [] })
  })

  test('the catalog alone resolves an alias to the newest of its family', () => {
    expect(agentModelRoute({ model: 'haiku' }, { catalog }).route).toEqual({
      modelId: 'claude-haiku-4-5',
      providerConnectionId: null,
    })
  })

  test('the model to inherit is kept when the alias is its own family', () => {
    const ids = ['openai/gpt-4o', 'anthropic/claude-sonnet-4-5', 'anthropic/claude-3-5-sonnet']
    const offered = ids.map((id) => ({ id, providerId: id.split('/')[0]! }))
    expect(
      agentModelRoute({ model: 'sonnet' }, { catalog: offered, inherit: 'openai/gpt-4o' }).route,
    ).toEqual({ modelId: 'anthropic/claude-sonnet-4-5', providerConnectionId: null })
    expect(
      agentModelRoute(
        { model: 'sonnet' },
        { catalog: offered, inherit: 'anthropic/claude-3-5-sonnet' },
      ).route.modelId,
    ).toBe('anthropic/claude-3-5-sonnet')
  })
})
