import { builtinAgentId, type AgentDefinition } from '@localixai/agent/agents'
import { builtinAgentPreset } from './builtin-agent-presets'
import type { VersionedCapabilityRuleRepository } from './rule-repository'
import { ApiError } from '../../lib/errors'
import type { CapabilitySourceRepository } from './source-repository'

/**
 * Bump this whenever a builtin role's preset changes. It is the WHOLE upgrade mechanism: an
 * install whose recorded version differs gets the new preset written over the role's scope on
 * the next boot, so shipping a fix to a system agent actually reaches the people who already
 * run one. Within a version nothing is rewritten, so an edit of the user's survives until we
 * ship a new answer for that role — at which point ours wins. Roles the product owns are
 * versioned data, not a document under joint authorship.
 */
// 10: the role rosters gained `plan` (plan mode's tool); without it a role's closed list denied
// the tool in the one mode that has it.
export const AGENT_PRESET_SEED_VERSION = '10'
const SEED_FIELD = 'presetSeed'

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
    // The list is ours to rewrite once we have written it before. Without a marker it may
    // hold rules from an install that configured this agent by hand — a decision that is not
    // ours to discard, so it is recorded as current and left where it is.
    if (typeof stored === 'string' || (existing.revision === 0 && existing.rules.length === 0)) {
      try {
        await ports.rules.publish(userId, agent.id, rules, existing.revision)
        seeded.push(agent.id)
      } catch (error) {
        // Another seed or a user's first save won. Never replace that newer decision.
        if (!(error instanceof ApiError) || error.code !== 'policy_conflict') throw error
      }
    }
    await ports.sources.patchConfig(userId, '', agent.id, {
      [SEED_FIELD]: AGENT_PRESET_SEED_VERSION,
    })
  }
  return seeded
}
