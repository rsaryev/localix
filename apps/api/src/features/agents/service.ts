import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { ConflictError, InvalidRequestError, NotFoundError } from '../../lib/domain-errors'
import {
  applySwitches,
  availabilityOf,
  createAvailabilityWriter,
} from '../capabilities/availability'
import { createInvocationRegistry } from '../capabilities/invocation'
import { composeCapabilities, type ResolvedCapabilities } from '../capabilities/resolve'
import { capabilitiesChanged, trackCapabilityChange } from '../capabilities/revision'
import type { Rule } from '../agent-core/capability-rule'
import { createAgentBindings, type AgentSnapshot, type BoundAgent } from './bindings/bindings'
import { createAgentAuthoring } from './authoring'
import type { AgentSummary } from './contracts'
import { createAgentFile, type CreatePorts } from './create'
import { agentFilePath, agentFileText, readAgentFileText, writeAgentFile } from './file-writer'
import { createAgentDelegation } from './delegation'
import { createAgentInvocationService } from './invocation-service'
import { agentTrustClass, summaryOf } from './projection'
import type { AgentsService, AgentsServiceDeps } from './service-contract'

export type { AgentsService, AgentsServiceDeps } from './service-contract'

interface Catalog {
  /** The definitions Claude Code would run, with access applied. */
  all: AgentSummary[]
  capabilitiesByAgent: ReadonlyMap<string, ResolvedCapabilities>
}

/**
 * A shipped type (`Explore`, `Plan`, `general-purpose`) has no row and no rules, and silence denies
 * a host; it is meant to take a delegated task, so that is its starting answer. Any rule a person
 * writes for it comes after and decides.
 */
const shippedInvocations = (entry: BoundAgent): Rule[] =>
  entry.agent.source === 'builtin' && entry.id !== DEFAULT_AGENT_ID
    ? [{ action: 'invocation:delegation', resource: entry.id, effect: 'allow' }]
    : []

/**
 * The agents of a scope: the catalog of Claude Code agent files (and plugin and built-in types),
 * each with the identity Localix keeps for it, and what the rules say it may do. A definition
 * lives in its file; this service only reads it, writes it back through the same file, and
 * answers access from the rules.
 */
export function createAgentsService(deps: AgentsServiceDeps): AgentsService {
  const stores = deps.capabilityStores
  const rules = stores.rules(deps.db)
  const availabilityWriter = createAvailabilityWriter(deps.db)
  const invocations = deps.invocations ?? createInvocationRegistry()
  const bindings = createAgentBindings({
    db: deps.db,
    stores,
    folders: deps.folders,
    plugins: deps.plugins,
    onChanged: () => capabilitiesChanged(),
  })

  const catalogOf = async (userId: string, snapshot: AgentSnapshot): Promise<Catalog> => {
    const active = snapshot.agents.filter((entry) => !entry.shadowedBy)
    const byAgent = await rules.readMany(
      userId,
      active.map((entry) => entry.id),
    )
    const rulesFor = (id: string) => byAgent.get(id) ?? []
    const all = active.map((entry) => {
      const own = rulesFor(entry.id)
      return summaryOf(entry, {
        enabled:
          availabilityOf(composeCapabilities(own)).effectFor(
            'agent',
            entry.id,
            agentTrustClass(entry.agent),
          ) === 'allow',
        invocations: invocations.availability([...shippedInvocations(entry), ...own], entry.id),
      })
    })
    return {
      all,
      capabilitiesByAgent: new Map(
        active.map((entry) => [entry.id, composeCapabilities(rulesFor(entry.id))]),
      ),
    }
  }
  const read = async (userId: string, scope: string) =>
    catalogOf(userId, await bindings.snapshot(userId, scope))
  /** The same inside `exclusive`, where the lock is already held. */
  const readLocked = async (userId: string, scope: string) =>
    (await catalogOf(userId, await bindings.reconcileNow(userId, scope))).all

  /** The one lookup of an agent by id, or by what a person typed: the catalog's `resolve`. */
  const find = async (
    userId: string,
    name: string,
    scope: string,
    snapshot?: AgentSnapshot,
  ): Promise<{ entry: BoundAgent; summary: AgentSummary } | undefined> => {
    const current = snapshot ?? (await bindings.snapshot(userId, scope))
    const { all } = await catalogOf(userId, current)
    const byId = current.agents.find((entry) => entry.id === name && !entry.shadowedBy)
    let entry = byId
    if (!entry) {
      const resolved = current.catalog.resolve(name)
      if (resolved && 'ambiguous' in resolved)
        throw new ConflictError('agent_ambiguous', 'Select an agent by ID')
      entry = resolved
        ? current.agents.find((candidate) => candidate.agent === resolved.agent)
        : undefined
    }
    const summary = entry ? all.find((candidate) => candidate.record.id === entry!.id) : undefined
    return entry && summary ? { entry, summary } : undefined
  }

  const changed = <T>(run: () => Promise<T>): Promise<T> =>
    trackCapabilityChange(async () => {
      const result = await run()
      capabilitiesChanged()
      return result
    })

  const createPorts: CreatePorts = {
    folders: deps.folders,
    list: readLocked,
    sources: stores.sources(deps.db, 'agent', deps.now),
    rules,
    availability: availabilityWriter,
  }

  const requireEntry = async (userId: string, name: string, scope: string) => {
    const found = await find(userId, name, scope)
    if (!found) throw new NotFoundError('agent_not_found', 'Agent not found')
    return found
  }
  const requireEditable = (summary: AgentSummary) => {
    if (!summary.editable)
      throw new InvalidRequestError(
        'agent_not_editable',
        'This agent comes from elsewhere. Copy it to Yours to change it.',
      )
  }
  const collides = (list: readonly AgentSummary[], handle: string, projectId: string, id: string) =>
    list.some(
      (agent) =>
        agent.editable &&
        agent.projectId === projectId &&
        agent.record.handle === handle &&
        agent.record.id !== id,
    )

  return {
    bindings,
    ...createAgentAuthoring(
      {
        ...createPorts,
        // Only called inside `exclusive`, so it reads without taking the lock again.
        find: async (userId, name, scope) =>
          (await find(userId, name, scope, await bindings.reconcileNow(userId, scope)))?.summary,
        sources: stores.sources(deps.db, 'agent', deps.now),
        rules,
      },
      bindings.exclusive,
    ),
    ...createAgentDelegation({
      snapshot: (userId, scope) => bindings.snapshot(userId, scope),
      summaries: async (userId, snapshot) => (await catalogOf(userId, snapshot)).all,
    }),
    ...createAgentInvocationService((userId, scope) => read(userId, scope), invocations),

    async listAgents(userId, opts) {
      return (await read(userId, opts?.projectId ?? '')).all
    },

    async assertPolicyChange(_userId, _projectId, deniedIds) {
      if (deniedIds.includes(DEFAULT_AGENT_ID)) throw alwaysEnabled()
    },

    setAgentEnabled: (userId, name, enabled, projectId) =>
      changed(async () => {
        const scope = projectId ?? ''
        const { summary } = await requireEntry(userId, name, scope)
        if (!enabled && summary.record.id === DEFAULT_AGENT_ID) throw alwaysEnabled()
        // An `agent:<id>` rule lives in that agent's OWN list: "may this role be invoked" is a
        // statement about the role, and keeping it beside its tool rules is what lets a delete
        // drop both in one write.
        await rules.mutate(userId, summary.record.id, (current) =>
          applySwitches(current, 'agent', [{ name: summary.record.id, enabled }]),
        )
        return (await requireEntry(userId, summary.record.id, scope)).summary
      }),

    async getAgent(userId, name, projectId) {
      return (await find(userId, name, projectId ?? ''))?.summary ?? null
    },

    createAgent: (userId, input) =>
      changed(() => bindings.exclusive(userId, () => createAgentFile(createPorts, userId, input))),

    updateAgent: (userId, name, input, projectId) =>
      changed(() =>
        bindings.exclusive(userId, async () => {
          const scope = projectId ?? ''
          const snapshot = await bindings.reconcileNow(userId, scope)
          const found = await find(userId, name, scope, snapshot)
          if (!found) throw new NotFoundError('agent_not_found', 'Agent not found')
          const { summary } = found
          requireEditable(summary)
          const { id } = summary.record
          const handle = input.handle
          if (handle.includes(':'))
            throw new InvalidRequestError('agent_name_invalid', 'An agent file name has no ":"')
          const renamed = handle !== summary.record.handle
          if (
            renamed &&
            collides((await catalogOf(userId, snapshot)).all, handle, summary.projectId, id)
          )
            throw new ConflictError('agent_exists', `An agent named "${handle}" already exists.`)
          const path = renamed ? agentFilePath(dirname(summary.path), handle) : summary.path
          let text: string
          try {
            text = agentFileText(await readAgentFileText(summary.path), { ...input, handle })
          } catch (error) {
            throw new InvalidRequestError(
              'agent_file_unreadable',
              error instanceof Error ? error.message : 'The agent file cannot be read',
            )
          }
          // The binding follows the file to its new name before the new file exists, so the
          // reconcile that sees it is a rename of this agent, never a second one.
          if (renamed)
            await stores
              .sources(deps.db, 'agent', deps.now)
              .patchConfig(userId, summary.projectId, id, { path })
          await writeAgentFile(path, text)
          if (renamed) await rm(summary.path, { force: true })
          return (await readLocked(userId, scope)).find((agent) => agent.record.id === id)!
        }),
      ),

    deleteAgent: (userId, name, projectId) =>
      changed(() =>
        bindings.exclusive(userId, async () => {
          const scope = projectId ?? ''
          const found = await find(userId, name, scope, await bindings.reconcileNow(userId, scope))
          if (!found) throw new NotFoundError('agent_not_found', 'Agent not found')
          const { summary } = found
          requireEditable(summary)
          await rm(summary.path, { force: true })
          await bindings.forget(userId, scope, summary.projectId, summary.record.id)
        }),
      ),

    duplicateAgent: (userId, name, newName, projectId) =>
      changed(async () => {
        const scope = projectId ?? ''
        const { summary } = await requireEntry(userId, name, scope)
        const { id, ...copied } = summary.record
        const policy = { id, rules: await rules.read(userId, id) }
        return bindings.exclusive(userId, () =>
          createAgentFile(
            createPorts,
            userId,
            { ...copied, handle: newName, projectId: scope || null, enabled: summary.enabled },
            policy,
          ),
        )
      }),

    async resolveEnabledAgent(userId, agentId, projectId) {
      const { all } = await read(userId, projectId ?? '')
      return all.find((agent) => agent.record.id === agentId && agent.enabled)?.record ?? null
    },

    async selectEnabledAgent(userId, handle, projectId) {
      const found = await find(userId, handle, projectId ?? '')
      return found?.summary.enabled ? found.summary.record : null
    },
  }
}

const alwaysEnabled = () =>
  new InvalidRequestError(
    'agent_always_enabled',
    'This agent cannot be switched off — the app runs on it. Copy one to Yours to change it.',
  )
