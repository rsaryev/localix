import { describe, expect, test } from 'bun:test'

import { addressedCooldownUntil } from './addressed-route-cooldown'
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

describe('the addressed participant’s cooldown', () => {
  const seat = (agentId: string, route: typeof A) => ({
    agentId,
    handle: agentId,
    reasoningEffort: 'medium' as const,
    ...route,
  })
  const party = { agents: [seat('lead', A), seat('qa', B)] }
  const untilOf =
    (held: Record<string, number>) => (route: { providerConnectionId: string | null }) =>
      held[route.providerConnectionId ?? ''] ?? null

  test('the addressee’s route answers, whatever the others are on', () => {
    expect(addressedCooldownUntil(party, 'qa', untilOf({ 'conn-a': T0 }))).toBeNull()
    expect(addressedCooldownUntil(party, 'lead', untilOf({ 'conn-a': T0 }))).toBe(T0)
  })

  test('unaddressed (or the addressee left): held only while everyone is, until the first frees', () => {
    expect(addressedCooldownUntil(party, undefined, untilOf({ 'conn-a': T0 }))).toBeNull()
    expect(addressedCooldownUntil(party, 'gone', untilOf({ 'conn-a': T0 }))).toBeNull()
    expect(
      addressedCooldownUntil(party, undefined, untilOf({ 'conn-a': T0 + 5, 'conn-b': T0 + 1 })),
    ).toBe(T0 + 1)
  })
})
