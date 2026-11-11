import type { TrustClass } from '../ext/trust'
import type { BoundAgent } from './bindings/bindings'
import { catalogTier } from '../plugins/kit'
import { agentFileOf, sourceKeyOf, type CatalogAgent } from './catalog/agent-file'
import type { AgentRecord, AgentSummary } from './contracts'

/**
 * A catalog definition as the record the rest of the app reads: the file's name is its name, its
 * body the instructions. Its `model` and `effort` are not read: the model an agent runs on is the
 * person's choice in Localix's settings (`agent-core/agent-model-route.ts`).
 */
export function recordOf(agent: CatalogAgent, id: string): AgentRecord {
  // Which of them preload is planned when the agent runs (`prompt-pinned-skills.ts`).
  const { description, prompt, maxTurns, skills } = agent.definition
  const preload = [...new Set(skills ?? [])]
  return {
    id,
    name: agent.name,
    description,
    // A type with no prompt of its own (`general-purpose` runs as the delegator) reads as its description.
    instructions: prompt.trim() || description,
    ...(maxTurns ? { maxTurns } : {}),
    ...(preload.length ? { skills: preload } : {}),
  }
}

/**
 * What silence means for an agent: a file in a project arrived with the repository and waits to be
 * asked about; the person's own files, the organisation's, a plugin's and the shipped types run.
 * The class travels into the rule lookup, so `agent:* untrusted ask` is a row a person could write.
 */
export const agentTrustClass = (agent: Pick<CatalogAgent, 'source'>): TrustClass =>
  catalogTier(agent.source) === 'project' ? 'untrusted' : 'bundled'

/** Only a file the person owns is edited in place; the rest is read-only or copied to Yours. */
const isEditable = (agent: Pick<CatalogAgent, 'source'>): boolean =>
  ['user', 'project'].includes(catalogTier(agent.source))

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
    source: sourceKeyOf(agent),
    path: agentFileOf(agent),
    editable: isEditable(agent),
  }
}
