import type { Kysely } from 'kysely'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import type { AppDatabase } from '../../db/types'
import { availabilityOf } from '../capabilities/availability'
import { composeCapabilities, type ResolvedCapabilities } from '../capabilities/resolve'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import { createCapabilityRuleRepository } from '../capabilities/rule-repository'
import type { InvocationRegistry } from '../capabilities/invocation'
import { createContributionReader, type ContributionReadError } from '../ext/contribution-reader'
import { agentContributionSchema } from './contribution'
import { discoverAgents } from './discovery'
import { registeredAgentSummary } from './registered-catalog'
import { agentTrustClass, toSummary } from './summary'
import { readBoundAgentRevisions } from './registration-policy'
import type { AgentSummary } from './contracts'
import { BUILTIN_OVERRIDE_FIELD } from './builtin-override'

interface AgentCatalog {
  all: AgentSummary[]
  capabilitiesByAgent: ReadonlyMap<string, ResolvedCapabilities>
  enabled: AgentSummary[]
  diagnostics: ContributionReadError[]
}

/** One scope's authored and registered definitions, evaluated against the same policy snapshot. */
export async function buildAgentCatalog(input: {
  db: Kysely<AppDatabase>
  invocations: InvocationRegistry
  userId: string
  projectId: string
  cwd: string | null
  globalDir?: string
}): Promise<AgentCatalog> {
  const { db, invocations, userId, projectId } = input
  if (!db.isTransaction)
    return db.transaction().execute((connection) => buildAgentCatalog({ ...input, db: connection }))
  const states = await createCapabilitySourceRepository(db, 'agent').listForScope(userId, projectId)
  const approvedBuiltinOverrides = new Map(
    states.flatMap((state) =>
      state.projectId === projectId && typeof state.config[BUILTIN_OVERRIDE_FIELD] === 'string'
        ? [[state.name, state.config[BUILTIN_OVERRIDE_FIELD] as string] as const]
        : [],
    ),
  )
  const [discovered, registered] = await Promise.all([
    discoverAgents({ ...input, approvedBuiltinOverrides }),
    createContributionReader(db, 'agent', agentContributionSchema).list(userId, projectId),
  ])
  const byAgent = await createCapabilityRuleRepository(db).readMany(userId, [
    ...new Set([
      DEFAULT_AGENT_ID,
      ...discovered.map((agent) => agent.record.id),
      ...registered.registrations.map((entry) => entry.id),
    ]),
  ])
  const rulesFor = (id: string) => byAgent.get(id) ?? []
  const sourceAvailability = availabilityOf(composeCapabilities(rulesFor(DEFAULT_AGENT_ID)))
  const reviewed = await readBoundAgentRevisions(
    db,
    userId,
    registered.registrations.map((entry) => entry.id),
  )
  const stateById = new Map(states.map((state) => [state.name, state]))
  const all = [
    ...discovered.map((item) => {
      const rules = rulesFor(item.record.id)
      const availability = availabilityOf(composeCapabilities(rules))
      return toSummary(
        item,
        stateById.get(item.record.id),
        // Same shape as a plugin's: a role we ship runs, one that appeared as a file waits to
        // be asked about. The trust class carries that into the rule lookup, so
        // `agent:* untrusted ask` is a row a person could write.
        availability.effectFor('agent', item.record.id, agentTrustClass(item)) === 'allow',
        invocations.availability(rules, item.record.id),
      )
    }),
    ...registered.registrations.map((entry) =>
      registeredAgentSummary(
        entry,
        rulesFor(entry.id),
        invocations,
        reviewed.get(entry.id) === entry.revision,
        Object.hasOwn({ plugin: true, mcp: true, agent: true }, entry.source.kind) &&
          sourceAvailability.effectFor(
            entry.source.kind as 'plugin' | 'mcp' | 'agent',
            entry.source.name,
          ) !== 'deny',
      ),
    ),
  ]
  return {
    all,
    capabilitiesByAgent: new Map(
      all.map(({ record }) => [record.id, composeCapabilities(rulesFor(record.id))]),
    ),
    enabled: all.filter((entry) => entry.enabled),
    diagnostics: registered.errors,
  }
}
