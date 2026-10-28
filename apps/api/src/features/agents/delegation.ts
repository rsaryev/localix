import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { isForkName } from '../agent-core/tools/agent/agent-fork'
import type { AgentSnapshot, BoundAgent } from './bindings/bindings'
import type { CatalogAgent } from './catalog/agent-file'
import type { AgentRecord, AgentSummary } from './contracts'

/**
 * Who a task goes to.
 *
 * `resolveDelegation` is the one lookup behind `Agent`, a workflow's `agent()` and a skill's
 * `context: fork`: the catalog's own `resolve` (so a file or plugin agent replaces a built-in of
 * the same name, and a bare plugin name only counts when one plugin alone has it), then Access.
 * Nothing else matches names.
 */
export type DelegationTarget =
  /** Start this agent as a fresh child; its definition is what the child runs on. */
  | { kind: 'agent'; agent: AgentRecord; definition: CatalogAgent }
  /** `general-purpose` and its alias: the delegating agent itself. */
  | { kind: 'self'; type: string }
  | { kind: 'ambiguous'; names: string[] }
  /** Nobody by that name here, or it is switched off, or its policy denies delegation. */
  | { kind: 'unavailable' }

/** One agent as the prompt's `# Agent directory` lists it. */
export interface AgentDirectoryRow {
  agentId: string
  name: string
  description: string
  enabled: boolean
  /** `Agent` can hand it a task. */
  delegable: boolean
  /** Its exact tool list, when its file has one. */
  tools?: string[]
  /** Runs as the delegator (`general-purpose`). */
  self?: boolean
}

export interface DelegationDeps {
  snapshot(userId: string, scope: string): Promise<AgentSnapshot>
  summaries(userId: string, snapshot: AgentSnapshot): Promise<AgentSummary[]>
}

const delegates = (summary: AgentSummary | undefined) =>
  Boolean(summary?.enabled && summary.invocations.delegation === 'allow')

export function createAgentDelegation(deps: DelegationDeps) {
  const entryOf = (snapshot: AgentSnapshot, reference: string) => {
    const wanted = reference.trim()
    const byId = snapshot.agents.find((entry) => entry.id === wanted && !entry.shadowedBy)
    if (byId) return byId
    const resolved = snapshot.catalog.resolve(wanted)
    if (!resolved) return null
    if ('ambiguous' in resolved) return resolved
    return snapshot.agents.find((entry) => entry.agent === resolved.agent) ?? null
  }

  return {
    async resolveDelegation(
      userId: string,
      reference: string,
      projectId?: string | null,
    ): Promise<DelegationTarget> {
      // `fork` asks for a fork of the delegator (`agent-fork.ts`); no agent can take the name.
      if (isForkName(reference.trim().replace(/^@/, ''))) return { kind: 'unavailable' }
      const snapshot = await deps.snapshot(userId, projectId ?? '')
      const found = entryOf(snapshot, reference)
      if (!found) return { kind: 'unavailable' }
      if ('ambiguous' in found) return { kind: 'ambiguous', names: found.ambiguous }
      const entry: BoundAgent = found
      const summary = (await deps.summaries(userId, snapshot)).find(
        (candidate) => candidate.record.id === entry.id,
      )
      if (!delegates(summary)) return { kind: 'unavailable' }
      if (entry.agent.self) return { kind: 'self', type: entry.agent.fullName }
      return { kind: 'agent', agent: summary!.record, definition: entry.agent }
    },

    /**
     * The definition the `agent` setting names, for the main thread to run as. Only an agent that is
     * on: the default agent and `general-purpose` are what the thread already is.
     */
    async resolveMainAgent(
      userId: string,
      reference: string,
      projectId?: string | null,
    ): Promise<CatalogAgent | null> {
      const snapshot = await deps.snapshot(userId, projectId ?? '')
      const found = entryOf(snapshot, reference)
      if (!found || 'ambiguous' in found || found.agent.self || found.id === DEFAULT_AGENT_ID)
        return null
      const summary = (await deps.summaries(userId, snapshot)).find(
        (candidate) => candidate.record.id === found.id,
      )
      return summary?.enabled ? found.agent : null
    },

    async directory(userId: string, projectId?: string | null): Promise<AgentDirectoryRow[]> {
      const snapshot = await deps.snapshot(userId, projectId ?? '')
      const definitions = new Map(snapshot.agents.map((entry) => [entry.id, entry.agent]))
      return (await deps.summaries(userId, snapshot)).map((summary) => {
        const definition = definitions.get(summary.record.id)
        return {
          agentId: summary.record.id,
          name: summary.record.name,
          description: summary.record.description,
          enabled: summary.enabled,
          delegable: delegates(summary) && !isForkName(summary.record.name),
          ...(definition?.tools ? { tools: definition.tools } : {}),
          ...(definition?.self ? { self: true } : {}),
        }
      })
    },
  }
}

export type AgentDelegation = ReturnType<typeof createAgentDelegation>
