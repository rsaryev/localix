import { builtinAgentId, DEFAULT_AGENT_HANDLE } from '@localixai/agent/agents'

import { ApiError } from '../../lib/errors'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { agentRecordInputSchema, type AgentRecordInput, type AgentSummary } from './contracts'
import { STARTER_TEAM } from './starter-team'

/** Bump only to offer a NEW role once; agents seeded under an earlier version are never rewritten. */
export const STARTER_TEAM_SEED_VERSION = '1'
const SEED_FIELD = 'starterTeamSeed'

export interface StarterTeamSeedPorts {
  createAgent(userId: string, input: AgentRecordInput): Promise<AgentSummary>
  /** The marker lives on the built-in fallback's capability source: one row per installation. */
  sources: Pick<CapabilitySourceRepository, 'get' | 'patchConfig'>
}

/**
 * Write the starter team into the global registry, once per installation.
 *
 * Once, because these are the person's agents from then on: an agent they deleted must not come
 * back on the next boot, and one they edited must not be overwritten. A handle that is already
 * taken keeps its owner's definition. The marker is written after the attempt, so a boot that
 * failed half-way retries only the roles still missing.
 */
export async function seedStarterTeam(
  ports: StarterTeamSeedPorts,
  userId: string,
): Promise<string[]> {
  const marker = builtinAgentId(DEFAULT_AGENT_HANDLE)
  const row = await ports.sources.get(userId, '', marker)
  if (row?.config[SEED_FIELD] === STARTER_TEAM_SEED_VERSION) return []
  const created: string[] = []
  for (const role of STARTER_TEAM) {
    try {
      await ports.createAgent(userId, agentRecordInputSchema.parse({ ...role, projectId: '' }))
      created.push(role.handle)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'agent_exists') continue
      throw error
    }
  }
  await ports.sources.patchConfig(userId, '', marker, { [SEED_FIELD]: STARTER_TEAM_SEED_VERSION })
  return created
}
