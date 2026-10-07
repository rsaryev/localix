import { describe, expect, test } from 'bun:test'
import type { Rule } from './rule'
import { builtinAgentPreset, legacyAgentPreset10 } from './builtin-agent-presets'
import { ApiError } from '../../lib/errors'
import {
  AGENT_PRESET_SEED_VERSION,
  seedAgentPresets,
  type AgentPresetSeedPorts,
  upgradeAgentPreset,
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
  test('untouched v12 defaults turn delegation off for specialists and the primary assistant', async () => {
    for (const handle of [
      'localix',
      'lead',
      'pm',
      'architect',
      'backend',
      'frontend',
      'qa',
      'design',
      'devops',
    ]) {
      const seat = { id: `builtin:${handle}`, handle }
      const { seedPorts, rules, configs } = ports([seat])
      const old = builtinAgentPreset(handle).filter((rule) => rule.action !== 'tool:agents')
      if (handle !== 'localix') {
        old.splice(1, 0, { action: 'tool:agents', resource: '*', effect: 'allow' })
      }
      rules.set(seat.id, old)
      configs.set(seat.id, { presetSeed: '12', presetSeedDefaults: old })
      expect(await seedAgentPresets(seedPorts, 'user')).toEqual([seat.id])
      expect(rules.get(seat.id)).toContainEqual({
        action: 'tool:agents',
        resource: '*',
        effect: 'deny',
      })
      expect(configs.get(seat.id)?.presetSeed).toBe('13')
    }
  })

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

  test('untouched v11 roles gain external-history investigation, while explicit restrictions survive', async () => {
    for (const customized of [false, true]) {
      const { seedPorts, rules, configs } = ports([SEAT])
      const old = builtinAgentPreset(SEAT.handle).filter(
        (rule) => rule.action !== 'tool:external_agent_sessions',
      )
      configs.set(SEAT.id, { presetSeed: '11', presetSeedDefaults: old })
      rules.set(
        SEAT.id,
        customized
          ? [...old, { action: 'tool:external_agent_sessions', resource: '*', effect: 'deny' }]
          : old,
      )
      const before = rules.get(SEAT.id)
      await seedAgentPresets(seedPorts, 'u1')
      if (customized) expect(rules.get(SEAT.id)).toEqual(before)
      else
        expect(rules.get(SEAT.id)).toContainEqual({
          action: 'tool:external_agent_sessions',
          resource: '*',
          effect: 'allow',
        })
    }
  })

  test('a legacy version without a saved baseline preserves user decisions', async () => {
    // The upgrade path, and the reason the marker carries a version rather than a flag: the
    // roles ship with the product, so a fix to one has to arrive with the next release instead
    // of only on installs that had never launched the app before.
    const { seedPorts, rules, configs, writes } = ports([SEAT])
    configs.set('builtin:backend', { presetSeed: '0' })
    rules.set('builtin:backend', [{ action: 'tool:write', resource: '*', effect: 'allow' }])

    expect(await seedAgentPresets(seedPorts, 'u1')).toEqual([])
    expect(writes).toEqual([])
    expect(rules.get('builtin:backend')).toEqual([
      { action: 'tool:write', resource: '*', effect: 'allow' },
    ])
    expect(configs.get('builtin:backend')?.presetSeed).toBe(AGENT_PRESET_SEED_VERSION)
  })

  test('upgrades untouched defaults while retaining a disabled agent switch', async () => {
    const { seedPorts, rules, configs } = ports([SEAT])
    const old: Rule[] = [{ action: 'tool:read', resource: '*', effect: 'allow' }]
    const disabled: Rule = { action: 'agent:builtin:backend', resource: '*', effect: 'deny' }
    configs.set(SEAT.id, { presetSeed: 'old', presetSeedDefaults: old })
    rules.set(SEAT.id, [...old, disabled])
    expect(await seedAgentPresets(seedPorts, 'u')).toEqual([SEAT.id])
    expect(rules.get(SEAT.id)?.at(-1)).toEqual(disabled)
    expect(rules.get(SEAT.id)?.[0].action).toBe('tool:*')
  })

  test('custom policy is never widened or reordered during an upgrade', () => {
    const baseline: Rule[] = [{ action: 'tool:*', resource: '*', effect: 'deny' }]
    const current: Rule[] = [
      ...baseline,
      { action: 'tool:read', resource: '/docs/*', effect: 'allow' },
    ]
    const next: Rule[] = [{ action: 'tool:*', resource: '*', effect: 'allow' }]
    expect(upgradeAgentPreset(current, baseline, next, SEAT.id)).toBeUndefined()
    expect(upgradeAgentPreset([], baseline, next, SEAT.id)).toBeUndefined()
  })

  test('known version 10 defaults upgrade while customized version 10 rules survive', async () => {
    const { seedPorts, rules, configs } = ports([SEAT])
    configs.set(SEAT.id, { presetSeed: '10' })
    rules.set(SEAT.id, legacyAgentPreset10(SEAT.handle))
    expect(await seedAgentPresets(seedPorts, 'u')).toEqual([SEAT.id])
    expect(rules.get(SEAT.id)).not.toEqual(legacyAgentPreset10(SEAT.handle))
    const custom: Rule[] = [
      ...legacyAgentPreset10(SEAT.handle),
      { action: 'tool:bash', resource: 'git push*', effect: 'deny' },
    ]
    configs.set(SEAT.id, { presetSeed: '10' })
    rules.set(SEAT.id, custom)
    expect(await seedAgentPresets(seedPorts, 'u')).toEqual([])
    expect(rules.get(SEAT.id)).toEqual(custom)
  })

  test('a conflicting save leaves the old marker and retries without replacing the user edit', async () => {
    const { seedPorts, rules, configs } = ports([SEAT])
    const old = legacyAgentPreset10(SEAT.handle)
    configs.set(SEAT.id, { presetSeed: '10' })
    rules.set(SEAT.id, old)
    const publish = seedPorts.rules.publish
    const custom: Rule[] = [...old, { action: 'tool:bash', resource: 'git push*', effect: 'deny' }]
    seedPorts.rules.publish = async () => {
      rules.set(SEAT.id, custom)
      throw new ApiError(409, 'policy_conflict', 'Concurrent save')
    }
    expect(await seedAgentPresets(seedPorts, 'u')).toEqual([])
    expect(configs.get(SEAT.id)?.presetSeed).toBe('10')
    seedPorts.rules.publish = publish
    expect(await seedAgentPresets(seedPorts, 'u')).toEqual([])
    expect(rules.get(SEAT.id)).toEqual(custom)
    expect(configs.get(SEAT.id)?.presetSeed).toBe(AGENT_PRESET_SEED_VERSION)
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
