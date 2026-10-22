import { describe, expect, test } from 'bun:test'

import { workflowAgentRoute, workflowConcurrency } from './agent-route'

/**
 * A workflow agent's `model` and `effort` against the catalog and the chat's provider, and how
 * many agents of a run go at once — Claude Code's rules, on Localix's routes.
 */
const chat = { providerId: 'anthropic', connectionId: 'conn-1', modelId: 'claude-opus-4-8' }
const catalog = [
  { id: 'claude-haiku-4-5', providerId: 'anthropic' },
  { id: 'claude-3-5-haiku', providerId: 'anthropic' },
  { id: 'claude-sonnet-5', providerId: 'anthropic' },
  { id: 'claude-opus-4-8', providerId: 'anthropic' },
  { id: 'gpt-6-luna', providerId: 'openai' },
]

describe('workflowAgentRoute', () => {
  test('an alias resolves to the newest of its family on the chat’s provider and connection', () => {
    expect(workflowAgentRoute({ model: 'haiku', chat, catalog })).toEqual({
      route: { providerConnectionId: 'conn-1', modelId: 'claude-haiku-4-5' },
      notes: [],
    })
    expect(workflowAgentRoute({ model: 'Sonnet', chat, catalog }).route.modelId).toBe(
      'claude-sonnet-5',
    )
  })

  test('a concrete id the provider offers is used; one it does not is noted and inherited', () => {
    expect(workflowAgentRoute({ model: 'claude-sonnet-5', chat, catalog }).route).toEqual({
      providerConnectionId: 'conn-1',
      modelId: 'claude-sonnet-5',
    })
    const elsewhere = workflowAgentRoute({ model: 'gpt-6-luna', chat, catalog })
    expect(elsewhere.route).toEqual({})
    expect(elsewhere.notes[0]).toContain('runs on claude-opus-4-8')
    expect(workflowAgentRoute({ model: 'inherit', chat, catalog })).toEqual({
      route: {},
      notes: [],
    })
  })

  test('effort becomes a reasoning level; an unknown word inherits and says so', () => {
    expect(workflowAgentRoute({ effort: 'xhigh', chat, catalog }).route).toEqual({
      reasoningEffort: 'xhigh',
    })
    const unknown = workflowAgentRoute({ effort: 'extreme', chat, catalog })
    expect(unknown.route).toEqual({})
    expect(unknown.notes[0]).toContain('not a reasoning level')
  })
})

describe('workflowConcurrency', () => {
  test('16 by default, fewer on a small machine, and the Claude Code variable within 1–256', () => {
    expect(workflowConcurrency({}, 32)).toBe(16)
    expect(workflowConcurrency({}, 6)).toBe(4)
    expect(workflowConcurrency({}, 1)).toBe(1)
    expect(workflowConcurrency({ CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: '40' }, 4)).toBe(40)
    expect(workflowConcurrency({ CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: '999' }, 4)).toBe(256)
    expect(
      workflowConcurrency(
        {
          LOCALIX_WORKFLOW_MAX_CONCURRENT_AGENTS: '2',
          CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: '40',
        },
        32,
      ),
    ).toBe(2)
  })
})
