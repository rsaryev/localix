import { describe, expect, test } from 'bun:test'
import { builtinAgentPreset } from './builtin-agent-presets'
import { ApiError } from '../../lib/errors'
import {
  AGENT_PRESET_SEED_VERSION,
  seedAgentPresets,
  upgradeAgentPreset,
  type AgentPresetSeedPorts,
} from './seed-agent-presets'
import type { Rule } from './rule'

const SEAT = { id: 'builtin:localix', handle: 'localix' }
function ports(agents = [SEAT]) {
  const rules = new Map<string, Rule[]>()
  const configs = new Map<string, Record<string, unknown>>()
  const writes: string[] = []
  const seedPorts: AgentPresetSeedPorts = {
    listAgents: async () => agents,
    rules: {
      readSnapshot: async (_user, id) => ({
        revision: rules.has(id) ? 1 : 0,
        rules: rules.get(id) ?? [],
      }),
      publish: async (_user, id, next) => {
        writes.push(id)
        rules.set(id, [...next])
        return 1
      },
    },
    sources: {
      get: async (_user, _project, name) =>
        configs.has(name) ? ({ name, config: configs.get(name)! } as never) : null,
      patchConfig: async (_user, _project, name, values) => {
        configs.set(name, { ...configs.get(name), ...values })
        return { name, config: configs.get(name)! } as never
      },
    },
  }
  return { seedPorts, rules, configs, writes }
}

describe('seedAgentPresets', () => {
  test('only Localix is seeded, once; retired and user identities are untouched', async () => {
    const h = ports([
      SEAT,
      { id: 'builtin:backend', handle: 'backend' },
      { id: 'builtin:lead', handle: 'lead' },
      { id: 'custom:localix', handle: 'localix' },
    ])
    const retired: Rule[] = [{ action: 'tool:write', resource: '*', effect: 'deny' }]
    h.rules.set('builtin:backend', retired)
    h.configs.set('builtin:backend', { presetSeed: '17' })
    expect(await seedAgentPresets(h.seedPorts, 'u')).toEqual([SEAT.id])
    expect(h.rules.get(SEAT.id)).toEqual(builtinAgentPreset('localix'))
    expect(await seedAgentPresets(h.seedPorts, 'u')).toEqual([])
    expect(h.writes).toEqual([SEAT.id])
    expect(h.rules.get('builtin:backend')).toEqual(retired)
    expect(h.configs.get('builtin:backend')).toEqual({ presetSeed: '17' })
    expect(h.configs.has('custom:localix')).toBe(false)
  })
  test('untouched legacy defaults upgrade, while customized policy preserves order and guards', async () => {
    for (const customized of [false, true]) {
      const h = ports()
      const old = [
        ...builtinAgentPreset('localix'),
        { action: 'tool:agents', resource: '*', effect: 'deny' as const },
      ]
      const current = customized
        ? [...old, { action: 'tool:read', resource: '/docs/*', effect: 'ask' as const }]
        : old
      h.rules.set(SEAT.id, current)
      h.configs.set(SEAT.id, { presetSeed: '15', presetSeedDefaults: old })
      expect(await seedAgentPresets(h.seedPorts, 'u')).toEqual(customized ? [] : [SEAT.id])
      expect(h.rules.get(SEAT.id)).toEqual(customized ? current : builtinAgentPreset('localix'))
      expect(h.configs.get(SEAT.id)?.presetSeed).toBe(AGENT_PRESET_SEED_VERSION)
    }
  })
  test('existing rules without a known baseline are never overwritten', async () => {
    for (const marker of [undefined, '0']) {
      const h = ports()
      const byHand: Rule[] = [{ action: 'tool:bash', resource: '*', effect: 'deny' }]
      h.rules.set(SEAT.id, byHand)
      if (marker) h.configs.set(SEAT.id, { presetSeed: marker })
      expect(await seedAgentPresets(h.seedPorts, 'u')).toEqual([])
      expect(h.rules.get(SEAT.id)).toEqual(byHand)
      expect(h.configs.get(SEAT.id)?.presetSeed).toBe(AGENT_PRESET_SEED_VERSION)
    }
  })
  test('ordered upgrades retain enabled choices and reject changed policies', () => {
    const baseline: Rule[] = [{ action: 'tool:*', resource: '*', effect: 'deny' }]
    const disabled: Rule = { action: 'agent:sample', resource: '*', effect: 'deny' }
    const next: Rule[] = [{ action: 'tool:read', resource: '*', effect: 'allow' }]
    expect(upgradeAgentPreset([...baseline, disabled], baseline, next, 'sample')).toEqual([
      ...next,
      disabled,
    ])
    expect(upgradeAgentPreset([...baseline, ...next], baseline, next, 'sample')).toBeUndefined()
    expect(upgradeAgentPreset([], undefined, next, 'sample')).toBeUndefined()
  })
  test('a conflicting user save leaves the old marker for retry', async () => {
    const h = ports()
    const old: Rule[] = [{ action: 'tool:read', resource: '*', effect: 'allow' }]
    const custom: Rule[] = [...old, { action: 'tool:bash', resource: '*', effect: 'deny' }]
    h.rules.set(SEAT.id, old)
    h.configs.set(SEAT.id, { presetSeed: '17', presetSeedDefaults: old })
    const publish = h.seedPorts.rules.publish
    h.seedPorts.rules.publish = async () => {
      h.rules.set(SEAT.id, custom)
      throw new ApiError(409, 'policy_conflict', 'Concurrent save')
    }
    expect(await seedAgentPresets(h.seedPorts, 'u')).toEqual([])
    expect(h.configs.get(SEAT.id)?.presetSeed).toBe('17')
    h.seedPorts.rules.publish = publish
    expect(await seedAgentPresets(h.seedPorts, 'u')).toEqual([])
    expect(h.rules.get(SEAT.id)).toEqual(custom)
    expect(h.configs.get(SEAT.id)?.presetSeed).toBe(AGENT_PRESET_SEED_VERSION)
  })
})
