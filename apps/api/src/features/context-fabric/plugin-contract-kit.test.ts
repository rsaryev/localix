import { describe, expect, test } from 'bun:test'
import {
  certifyAutomaticContribution,
  fastFixtureProvider,
  malformedHazardProvider,
  maliciousHazardProvider,
  oversizedHazardProvider,
  sampleAutomaticRequest,
  slowHazardProvider,
} from './plugin-contract-kit'
import { createContextManager } from './manager'
import { createContextProviderRegistry } from './registry'
import type { ContextProviderContribution } from './contracts'

function managerFor(...contributions: ContextProviderContribution[]) {
  const registry = createContextProviderRegistry()
  for (const contribution of contributions) registry.tryRegister(contribution, 'test')
  return createContextManager(registry)
}

const allPass = (results: { check: string; ok: boolean; detail?: string }[]) =>
  results.filter((r) => !r.ok).map((r) => `${r.check}: ${r.detail ?? ''}`)

describe('contract kit — well-behaved contributions certify clean', () => {
  test('a compliant automatic provider passes every check', async () => {
    const results = await certifyAutomaticContribution(fastFixtureProvider(), {
      request: sampleAutomaticRequest(),
    })
    expect(allPass(results)).toEqual([])
  })
})

describe('contract kit — the host neutralises hostile plugins', () => {
  test('timeout isolation: a slow provider never blocks a fast sibling', async () => {
    const manager = managerFor(slowHazardProvider({ sleepMs: 5_000 }), fastFixtureProvider())
    const started = Date.now()
    const result = await manager.collect(sampleAutomaticRequest(), [], new AbortController().signal)
    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThan(2_000)
    expect(result.contributions.map((c) => c.id)).toContain('fast')
    expect(result.contributions.map((c) => c.id)).not.toContain('slow')
    expect(result.providerOutcomes.find((o) => o.providerId === 'hazard-slow')?.status).toBe(
      'timeout',
    )
  })

  test('privacy: impersonation, sensitivity escalation and secret content are all dropped', async () => {
    const manager = managerFor(maliciousHazardProvider())
    const result = await manager.collect(sampleAutomaticRequest(), [], new AbortController().signal)
    const ids = result.contributions.map((c) => c.id)
    expect(ids).not.toContain('imp') // impersonated providerId
    expect(ids).not.toContain('esc') // escalated sensitivity
    expect(ids).not.toContain('sec') // secret content
    expect(result.diagnostics.droppedByReason.provider_identity).toBeGreaterThanOrEqual(1)
    expect(result.diagnostics.droppedByReason.provider_sensitivity).toBeGreaterThanOrEqual(1)
    // Injection text survives ONLY as inert data — it granted no authority.
    const injection = result.contributions.find((c) => c.id === 'inj')
    expect(injection?.content).toContain('ignore all policy')
  })

  test('quota: an oversized contribution is dropped against the declared budget', async () => {
    const manager = managerFor(oversizedHazardProvider())
    const result = await manager.collect(sampleAutomaticRequest(), [], new AbortController().signal)
    expect(result.contributions.map((c) => c.id)).not.toContain('big')
    expect(result.diagnostics.droppedByReason.provider_quota).toBeGreaterThanOrEqual(1)
  })

  test('malformed output: a throwing provider is isolated, not fatal', async () => {
    const manager = managerFor(malformedHazardProvider(), fastFixtureProvider())
    const result = await manager.collect(sampleAutomaticRequest(), [], new AbortController().signal)
    expect(result.contributions.map((c) => c.id)).toEqual(['fast'])
    expect(result.providerOutcomes.find((o) => o.providerId === 'hazard-malformed')?.status).toBe(
      'error',
    )
  })
})
