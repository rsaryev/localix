import { describe, expect, test } from 'bun:test'
import { builtinAgentPreset } from './builtin-agent-presets'
import { ApiError } from '../../lib/errors'
import {
  AGENT_PRESET_SEED_VERSION,
  seedAgentPresets,
  upgradeAgentPreset,
  type AgentPresetSeedPorts,
} from './seed-agent-presets'
import type { Rule } from '../agent-core/capability-rule'

const AGENT = { id: 'builtin:localix', name: 'localix' }
function ports(agents = [AGENT]) {
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
      AGENT,
      { id: 'builtin:backend', name: 'backend' },
      { id: 'builtin:lead', name: 'lead' },
      { id: 'custom:localix', name: 'localix' },
    ])
    const retired: Rule[] = [{ action: 'tool:Write', resource: '*', effect: 'deny' }]
    h.rules.set('builtin:backend', retired)
    h.configs.set('builtin:backend', { presetSeed: '17' })
    expect(await seedAgentPresets(h.seedPorts, 'u')).toEqual([AGENT.id])
    expect(h.rules.get(AGENT.id)).toEqual(builtinAgentPreset('localix'))
    expect(await seedAgentPresets(h.seedPorts, 'u')).toEqual([])
    expect(h.writes).toEqual([AGENT.id])
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
        ? [...old, { action: 'tool:Read', resource: '/docs/*', effect: 'ask' as const }]
        : old
      h.rules.set(AGENT.id, current)
      h.configs.set(AGENT.id, { presetSeed: '15', presetSeedDefaults: old })
      expect(await seedAgentPresets(h.seedPorts, 'u')).toEqual(customized ? [] : [AGENT.id])
      expect(h.rules.get(AGENT.id)).toEqual(customized ? current : builtinAgentPreset('localix'))
      expect(h.configs.get(AGENT.id)?.presetSeed).toBe(AGENT_PRESET_SEED_VERSION)
    }
  })
  test('existing rules without a known baseline are never overwritten', async () => {
    for (const marker of [undefined, '0']) {
      const h = ports()
      const byHand: Rule[] = [{ action: 'tool:Bash', resource: '*', effect: 'deny' }]
      h.rules.set(AGENT.id, byHand)
      if (marker) h.configs.set(AGENT.id, { presetSeed: marker })
      expect(await seedAgentPresets(h.seedPorts, 'u')).toEqual([])
      expect(h.rules.get(AGENT.id)).toEqual(byHand)
      expect(h.configs.get(AGENT.id)?.presetSeed).toBe(AGENT_PRESET_SEED_VERSION)
    }
  })
  test('ordered upgrades retain enabled choices and reject changed policies', () => {
    const baseline: Rule[] = [{ action: 'tool:*', resource: '*', effect: 'deny' }]
    const disabled: Rule = { action: 'agent:sample', resource: '*', effect: 'deny' }
    const next: Rule[] = [{ action: 'tool:Read', resource: '*', effect: 'allow' }]
    expect(upgradeAgentPreset([...baseline, disabled], baseline, next, 'sample')).toEqual([
      ...next,
      disabled,
    ])
    expect(upgradeAgentPreset([...baseline, ...next], baseline, next, 'sample')).toBeUndefined()
    expect(upgradeAgentPreset([], undefined, next, 'sample')).toBeUndefined()
  })
  test('a conflicting user save leaves the old marker for retry', async () => {
    const h = ports()
    const old: Rule[] = [{ action: 'tool:Read', resource: '*', effect: 'allow' }]
    const custom: Rule[] = [...old, { action: 'tool:Bash', resource: '*', effect: 'deny' }]
    h.rules.set(AGENT.id, old)
    h.configs.set(AGENT.id, { presetSeed: '17', presetSeedDefaults: old })
    const publish = h.seedPorts.rules.publish
    h.seedPorts.rules.publish = async () => {
      h.rules.set(AGENT.id, custom)
      throw new ApiError(409, 'policy_conflict', 'Concurrent save')
    }
    expect(await seedAgentPresets(h.seedPorts, 'u')).toEqual([])
    expect(h.configs.get(AGENT.id)?.presetSeed).toBe('17')
    h.seedPorts.rules.publish = publish
    expect(await seedAgentPresets(h.seedPorts, 'u')).toEqual([])
    expect(h.rules.get(AGENT.id)).toEqual(custom)
    expect(h.configs.get(AGENT.id)?.presetSeed).toBe(AGENT_PRESET_SEED_VERSION)
  })
})
