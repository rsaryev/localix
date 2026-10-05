import { builtinAgentId, type AgentDefinition } from '@localixai/agent/agents'
import { builtinAgentPreset, legacyAgentPreset10 } from './builtin-agent-presets'
import type { VersionedCapabilityRuleRepository } from './rule-repository'
import { ApiError } from '../../lib/errors'
import type { CapabilitySourceRepository } from './source-repository'
import { capabilityRuleSchema } from './rule-schema'
import type { Rule } from './rule'

/**
 * Bump when shipped policy changes. Untouched defaults can advance; a customized ordered
 * policy stays the user's. Keep the last shipped baseline so upgrades can distinguish them.
 * Enable choices are always retained, including when the rest of the policy is untouched.
 */
// 10: the role rosters gained `plan` (plan mode's tool); without it a role's closed list denied
// the tool in the one mode that has it.
export const AGENT_PRESET_SEED_VERSION = '11'
const SEED_FIELD = 'presetSeed'
const BASE_FIELD = 'presetSeedDefaults'

const sameRules = (a: readonly Rule[], b: readonly Rule[]) =>
  JSON.stringify(a) === JSON.stringify(b)

/** Ordered rules cannot be merged row by row without changing the meaning of exceptions. */
export function upgradeAgentPreset(
  current: readonly Rule[],
  baseline: readonly Rule[] | undefined,
  next: readonly Rule[],
  agentId: string,
): Rule[] | undefined {
  if (!baseline) return undefined
  const isSwitch = (rule: Rule) => rule.action === `agent:${agentId}`
  const choices = current.filter(isSwitch)
  if (
    !sameRules(
      current.filter((rule) => !isSwitch(rule)),
      baseline.filter((rule) => !isSwitch(rule)),
    )
  ) {
    return undefined
  }
  const upgraded = [...next.filter((rule) => !isSwitch(rule)), ...choices]
  return sameRules(upgraded, current) ? undefined : upgraded
}

export interface AgentPresetSeedPorts {
  listAgents(userId: string): Promise<readonly Pick<AgentDefinition, 'id' | 'handle'>[]>
  rules: Pick<VersionedCapabilityRuleRepository, 'readSnapshot' | 'publish'>
  sources: Pick<CapabilitySourceRepository, 'get' | 'patchConfig'>
}

/** Definitions never carry policy. Builtin defaults are independently versioned seed data. */
export async function seedAgentPresets(
  ports: AgentPresetSeedPorts,
  userId: string,
): Promise<string[]> {
  const seeded: string[] = []
  for (const agent of await ports.listAgents(userId)) {
    if (agent.id !== builtinAgentId(agent.handle)) continue
    const rules = builtinAgentPreset(agent.handle)
    if (rules.length === 0) continue
    const row = await ports.sources.get(userId, '', agent.id)
    const stored = row?.config[SEED_FIELD]
    if (stored === AGENT_PRESET_SEED_VERSION) continue
    const existing = await ports.rules.readSnapshot(userId, agent.id)
    const parsedBase = capabilityRuleSchema.array().safeParse(row?.config[BASE_FIELD])
    // Before baseline tracking, a marker alone cannot prove that policy was untouched.
    // Preserve it. Fresh installs have no decision to preserve and receive the defaults.
    const next =
      existing.revision === 0 && existing.rules.length === 0
        ? rules
        : upgradeAgentPreset(
            existing.rules,
            parsedBase.success
              ? parsedBase.data
              : stored === '10'
                ? legacyAgentPreset10(agent.handle)
                : undefined,
            rules,
            agent.id,
          )
    if (next) {
      try {
        await ports.rules.publish(userId, agent.id, next, existing.revision)
        seeded.push(agent.id)
      } catch (error) {
        // Another seed or a user's first save won. Never replace that newer decision.
        if (!(error instanceof ApiError) || error.code !== 'policy_conflict') throw error
        // Retry on the next boot; a conflict must not certify a failed upgrade as current.
        continue
      }
    }
    await ports.sources.patchConfig(userId, '', agent.id, {
      [SEED_FIELD]: AGENT_PRESET_SEED_VERSION,
      [BASE_FIELD]: rules,
    })
  }
  return seeded
}
