import { describe, expect, test } from 'bun:test'
import type { Rule } from './rule'
import {
  AGENT_PRESET_SEED_VERSION,
  seedAgentPresets,
  type AgentPresetSeedPorts,
} from './seed-agent-presets'

type SeedableAgent = Awaited<ReturnType<AgentPresetSeedPorts['listAgents']>>[number]

function ports(agents: SeedableAgent[]) {
  const rules = new Map<string, Rule[]>()
  const configs = new Map<string, Record<string, unknown>>()
  const writes: string[] = []
  const seedPorts: AgentPresetSeedPorts = {
    listAgents: async () => agents,
    rules: {
      readSnapshot: async (_user, scope) => ({ revision: 0, rules: rules.get(scope) ?? [] }),
      publish: async (_user, scope, next) => {
        writes.push(scope)
        rules.set(scope, [...next])
        return 1
      },
    },
    sources: {
      get: async (_user, _project, name) => {
        const config = configs.get(name)
        return config ? ({ name, config } as never) : null
      },
      patchConfig: async (_user, _project, name, values) => {
        configs.set(name, { ...configs.get(name), ...values })
        return { name, config: configs.get(name)! } as never
      },
    },
  }
  return { seedPorts, rules, configs, writes }
}

const SEAT: SeedableAgent = { id: 'builtin:backend', handle: 'backend' }

describe('seedAgentPresets', () => {
  test('writes a role its preset, once', async () => {
    const { seedPorts, rules, writes } = ports([SEAT])

    expect(await seedAgentPresets(seedPorts, 'u1')).toEqual(['builtin:backend'])
    expect(rules.get('builtin:backend')?.[0]).toEqual({
      action: 'tool:*',
      resource: '*',
      effect: 'deny',
    })

    // The second run is the one that matters: a definition that kept re-asserting itself
    // would undo whatever the user changed in between, on every boot.
    expect(await seedAgentPresets(seedPorts, 'u1')).toEqual([])
    expect(writes).toHaveLength(1)
  })

  test('a user edit survives every boot on the preset version it was made on', async () => {
    const { seedPorts, rules } = ports([SEAT])
    await seedAgentPresets(seedPorts, 'u1')

    rules.set('builtin:backend', [{ action: 'tool:write', resource: '*', effect: 'allow' }])
    await seedAgentPresets(seedPorts, 'u1')

    expect(rules.get('builtin:backend')).toEqual([
      { action: 'tool:write', resource: '*', effect: 'allow' },
    ])
  })

  test('a new preset version reaches an install that is already running an old one', async () => {
    // The upgrade path, and the reason the marker carries a version rather than a flag: the
    // roles ship with the product, so a fix to one has to arrive with the next release instead
    // of only on installs that had never launched the app before.
    const { seedPorts, rules, configs, writes } = ports([SEAT])
    configs.set('builtin:backend', { presetSeed: '0' })
    rules.set('builtin:backend', [{ action: 'tool:write', resource: '*', effect: 'allow' }])

    expect(await seedAgentPresets(seedPorts, 'u1')).toEqual(['builtin:backend'])
    expect(writes).toEqual(['builtin:backend'])
    expect(rules.get('builtin:backend')?.[0]).toEqual({
      action: 'tool:*',
      resource: '*',
      effect: 'deny',
    })
    expect(configs.get('builtin:backend')?.presetSeed).toBe(AGENT_PRESET_SEED_VERSION)
  })

  test('an install that configured this agent BEFORE presets existed is not overwritten', async () => {
    // No marker, but rules are there: someone set them by hand. Wiping them on the first
    // boot after this ships would discard a decision the user made — so it is recorded as
    // seeded and nothing is written.
    const { seedPorts, rules, configs, writes } = ports([SEAT])
    const byHand: Rule[] = [{ action: 'tool:bash', resource: '*', effect: 'deny' }]
    rules.set('builtin:backend', byHand)

    expect(await seedAgentPresets(seedPorts, 'u1')).toEqual([])
    expect(rules.get('builtin:backend')).toEqual(byHand)
    expect(writes).toHaveLength(0)
    expect(configs.get('builtin:backend')?.presetSeed).toBe(AGENT_PRESET_SEED_VERSION)
  })

  test('an agent with no preset is left entirely alone', async () => {
    // Its scope must inherit exactly as before, and it must not even get a marker: if its
    // record later grows a preset, that is the moment to seed it.
    const { seedPorts, rules, configs } = ports([{ id: 'custom:localix', handle: 'localix' }])

    expect(await seedAgentPresets(seedPorts, 'u1')).toEqual([])
    expect(rules.size).toBe(0)
    expect(configs.size).toBe(0)
  })

  test('one agent failing to be interesting does not stop the others', async () => {
    const { seedPorts, writes } = ports([
      { id: 'custom:localix', handle: 'localix' },
      SEAT,
      { id: 'builtin:lead', handle: 'lead' },
    ])
    expect((await seedAgentPresets(seedPorts, 'u1')).sort()).toEqual([
      'builtin:backend',
      'builtin:lead',
    ])
    expect(writes.sort()).toEqual(['builtin:backend', 'builtin:lead'])
  })
})
