import { describe, expect, test } from 'bun:test'

import { ApiError } from '../../lib/errors'
import type { AgentRecordInput, AgentSummary } from './contracts'
import { seedStarterTeam, STARTER_TEAM_SEED_VERSION } from './seed-starter-team'
import { STARTER_TEAM } from './starter-team'

function harness(existing: string[] = []) {
  const registry = new Map<string, AgentRecordInput>()
  const config: Record<string, unknown> = {}
  for (const handle of existing) registry.set(handle, { handle, instructions: 'Mine.' } as never)
  const ports = {
    createAgent: async (_userId: string, input: AgentRecordInput) => {
      if (registry.has(input.handle)) throw new ApiError(409, 'agent_exists', 'exists')
      registry.set(input.handle, input)
      return {} as AgentSummary
    },
    sources: {
      get: async () => ({ config }) as never,
      patchConfig: async (_u: string, _p: string, _n: string, values: Record<string, unknown>) => {
        Object.assign(config, values)
      },
    },
  }
  return { ports, registry, config }
}

describe('the starter team', () => {
  test('is written once into the global registry as ordinary agents', async () => {
    const h = harness()
    const created = await seedStarterTeam(h.ports as never, 'u')
    expect(created).toEqual(STARTER_TEAM.map((role) => role.handle))
    expect(h.registry.get('devops')).toMatchObject({ projectId: '', leadershipPriority: 0 })
    expect(h.config.starterTeamSeed).toBe(STARTER_TEAM_SEED_VERSION)
  })

  test('an agent the person deleted never comes back', async () => {
    const h = harness()
    await seedStarterTeam(h.ports as never, 'u')
    h.registry.delete('devops')
    expect(await seedStarterTeam(h.ports as never, 'u')).toEqual([])
    expect(h.registry.has('devops')).toBe(false)
  })

  test('a handle the person already uses keeps its definition', async () => {
    const h = harness(['devops'])
    const created = await seedStarterTeam(h.ports as never, 'u')
    expect(created).not.toContain('devops')
    expect(h.registry.get('devops')?.instructions).toBe('Mine.')
  })

  test('no role names the removed delegation model or a parent session', () => {
    for (const role of STARTER_TEAM) {
      expect(role.instructions).not.toMatch(/delegat|parent/i)
      expect(role.handle).not.toBe('localix')
    }
  })
})
