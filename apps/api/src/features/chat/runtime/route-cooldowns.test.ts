import { describe, expect, test } from 'bun:test'

import { sessionCooldownUntil } from './session-route-cooldown'
import { createRouteCooldowns } from './route-cooldowns'

const A = { providerConnectionId: 'conn-a', modelId: 'openai/gpt-5' }
const B = { providerConnectionId: 'conn-b', modelId: 'anthropic/claude' }
const T0 = 1_000_000

describe('route cooldowns', () => {
  test('a hold is per route: another connection, or another model on it, stays admitted', () => {
    const cooldowns = createRouteCooldowns()
    cooldowns.hold(A, 'route', T0 + 60_000)
    expect(cooldowns.until(A, T0)).toBe(T0 + 60_000)
    expect(cooldowns.until(B, T0)).toBeNull()
    expect(cooldowns.until({ ...A, modelId: 'openai/gpt-5-mini' }, T0)).toBeNull()
  })

  test('a connection-wide hold covers every model on that connection', () => {
    const cooldowns = createRouteCooldowns()
    cooldowns.hold(A, 'connection', T0 + 60_000)
    expect(cooldowns.until({ ...A, modelId: 'openai/gpt-5-mini' }, T0)).toBe(T0 + 60_000)
    expect(cooldowns.until(B, T0)).toBeNull()
  })

  test('a blank connection never widens: chain-resolved routes do not share one key', () => {
    // Without the guard every route with no stated connection would collapse into `connection:`.
    const cooldowns = createRouteCooldowns()
    const blank = { providerConnectionId: null, modelId: 'openai/gpt-5' }
    cooldowns.hold(blank, 'connection', T0 + 60_000)
    expect(cooldowns.until(blank, T0)).toBe(T0 + 60_000)
    expect(cooldowns.until({ providerConnectionId: null, modelId: 'x/other' }, T0)).toBeNull()
  })

  test('a shorter later hold never shortens a longer one, and an expired hold admits', () => {
    const cooldowns = createRouteCooldowns()
    cooldowns.hold(A, 'route', T0 + 30 * 60_000)
    cooldowns.hold(A, 'route', T0 + 60_000)
    expect(cooldowns.until(A, T0)).toBe(T0 + 30 * 60_000)
    expect(cooldowns.until(A, T0 + 30 * 60_000)).toBeNull()
  })
})

describe('the conversation’s cooldown', () => {
  const agent = (route: typeof A) => ({
    agentId: 'lead',
    name: 'lead',
    reasoningEffort: 'medium' as const,
    ...route,
  })
  const untilOf =
    (held: Record<string, number>) => (route: { providerConnectionId: string | null }) =>
      held[route.providerConnectionId ?? ''] ?? null

  test('the agent’s route answers', () => {
    expect(sessionCooldownUntil({ agent: agent(A) }, untilOf({ 'conn-a': T0 }))).toBe(T0)
    expect(sessionCooldownUntil({ agent: agent(B) }, untilOf({ 'conn-a': T0 }))).toBeNull()
  })
})
