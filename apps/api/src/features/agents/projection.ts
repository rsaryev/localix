import type { TrustClass } from '../ext/trust'
import type { BoundAgent } from './bindings/bindings'
import type { CatalogAgent } from './catalog/agent-file'
import type { AgentRecord, AgentSummary } from './contracts'
import { preloadedSkills } from '../plugins/agent-names'

/**
 * A catalog definition as the record the rest of the app reads: the file's name is its name, its
 * body the instructions. Its `model` and `effort` are not read: the model an agent runs on is the
 * person's choice in Localix's settings (`agent-core/agent-model-route.ts`).
 */
export function recordOf(agent: CatalogAgent, id: string): AgentRecord {
  // Claude Code preloads the first 32 distinct skills of the list.
  const preload = preloadedSkills(agent.pinnedSkills)
  return {
    id,
    name: agent.fullName,
    description: agent.description,
    // A type with no prompt of its own (`general-purpose` runs as the delegator) reads as its description.
    instructions: agent.prompt.trim() || agent.description,
    ...(agent.maxTurns ? { maxTurns: agent.maxTurns } : {}),
    ...(preload.length ? { skills: preload } : {}),
  }
}

/**
 * What silence means for an agent: a file in a project arrived with the repository and waits to be
 * asked about; the person's own files, the organisation's, a plugin's and the shipped types run.
 * The class travels into the rule lookup, so `agent:* untrusted ask` is a row a person could write.
 */
export const agentTrustClass = (agent: Pick<CatalogAgent, 'source'>): TrustClass =>
  agent.source === 'project' ? 'untrusted' : 'bundled'

/** Only a file the person owns is edited in place; the rest is read-only or copied to Yours. */
export const isEditableSource = (source: CatalogAgent['source']): boolean =>
  source === 'user' || source === 'project'

export function summaryOf(
  entry: BoundAgent,
  state: { enabled: boolean; invocations: AgentSummary['invocations'] },
): AgentSummary {
  const { agent } = entry
  return {
    record: recordOf(agent, entry.id),
    projectId: agent.projectId,
    scope: agent.projectId ? 'project' : 'global',
    enabled: state.enabled,
    invocations: state.invocations,
    source: agent.source === 'plugin' ? `plugin:${agent.pluginName}` : agent.source,
    path: agent.path,
    editable: isEditableSource(agent.source),
  }
}
