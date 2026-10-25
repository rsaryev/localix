import { isReasoningEffort } from '@localixai/agent'
import { isModelAliasFamily } from '../agent-core/model-alias'
import type { TrustClass } from '../ext/trust'
import type { BoundAgent } from './bindings/bindings'
import type { CatalogAgent } from './catalog/agent-file'
import type { AgentRecord, AgentSummary } from './contracts'
import { preloadedSkills } from '../plugins/agent-names'

/**
 * A catalog definition as the record the rest of the app reads: the file's name is the handle, its
 * body the instructions, the `localix:` key the hierarchy priority and memory scope. Only a
 * concrete model reaches `modelPreference`: an alias (`opus`) needs the provider's catalog to mean
 * anything and is resolved where a run is routed (`agentModelRoute`), never guessed here.
 */
export function recordOf(agent: CatalogAgent, id: string): AgentRecord {
  const route = agent.localix.model?.split('/')
  const provider = route && route.length > 1 ? route[0] : undefined
  const model =
    provider && route
      ? route.slice(1).join('/')
      : agent.preferredModel &&
          agent.preferredModel.toLowerCase() !== 'inherit' &&
          !isModelAliasFamily(agent.preferredModel)
        ? agent.preferredModel
        : (agent.localix.model ?? undefined)
  const asked = agent.localix.effort ?? agent.preferredEffort
  const effort = asked && isReasoningEffort(asked) ? asked : undefined
  const memory = agent.localix.memoryScope
  // Claude Code preloads the first 32 distinct skills of the list.
  const preload = preloadedSkills(agent.pinnedSkills)
  return {
    id,
    handle: agent.fullName,
    description: agent.description,
    // A type with no prompt of its own (`general-purpose` runs as the delegator) reads as its description.
    instructions: agent.prompt.trim() || agent.description,
    leadershipPriority: agent.localix.priority,
    ...(model || effort
      ? {
          modelPreference: {
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
          },
        }
      : {}),
    ...(agent.maxTurns ? { limits: { maxTurns: agent.maxTurns } } : {}),
    ...(preload.length || memory
      ? {
          context: {
            ...(preload.length ? { preloadSkills: preload } : {}),
            ...(memory ? { memory: { scope: memory } } : {}),
          },
        }
      : {}),
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
