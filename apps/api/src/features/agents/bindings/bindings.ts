import { randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import { SEMANTIC_GLOBAL_SCOPE } from '@localixai/mini-app-sdk/backend'
import { builtinAgentId } from '@localixai/agent/agents'
import type { AppDatabase } from '../../../db/types'
import { createKeyedSerializer } from '../../../lib/keyed-serializer'
import { applySwitches } from '../../capabilities/availability'
import { inheritedAgentPreset } from '../../capabilities/builtin-agent-presets'
import type { CapabilitySourceRecord } from '../../capabilities/source-repository'
import type { CapabilityStores } from '../../capabilities/store-factory'
import { recordCoreChanges, type CoreChange } from '../../changes/core-entities'
import {
  agentFileOf,
  sourceKeyOf,
  type CatalogAgent,
  type ResolvedAgent,
} from '../catalog/agent-file'
import { composeCatalog, type ScopeCatalog } from '../catalog/compose'
import {
  GRACE_MS,
  groupKey,
  planBindings,
  type BindingGroup,
  type BindingPlan,
  type BoundRow,
  type FoundAgent,
} from './plan'

export interface BindingDeps {
  db: Kysely<AppDatabase>
  stores: CapabilityStores
  /** The scope's subagents as the kit resolves them, with its plugins and the mods' agents. */
  catalog(userId: string, projectId: string): Promise<ScopeCatalog>
  now?: () => number
  newId?: () => string
  /** Called once a reconcile has committed a change, so capability readers re-read the agents. */
  onChanged?: () => void
}

/** A definition with the identity Localix keeps for it. */
export interface BoundAgent {
  id: string
  agent: CatalogAgent
  shadowedBy?: CatalogAgent
}

export interface AgentSnapshot {
  /** The one lookup of an agent by what a person or model typed (`catalog/compose.ts`). */
  readonly resolve: (reference: string) => ResolvedAgent
  /** The agent the main conversation runs as (`catalog/compose.ts`), or none. */
  readonly main: CatalogAgent | null
  agents: readonly BoundAgent[]
  /** The agents folders the catalog read, to watch for changes. */
  watch: readonly string[]
  /** When the first missing definition of this scope is due to be purged, or null. */
  purgeDueAt: number | null
}

/** The sources every read lists whole: the folders, and the agents mods register (`flag`). */
const READ_SOURCES = new Set(['user', 'project', 'managed', 'flag'])
const text = (value: unknown) => (typeof value === 'string' ? value : '')

const toBoundRow = (record: CapabilitySourceRecord): BoundRow => ({
  id: record.name,
  projectId: record.projectId,
  source: record.source,
  name: text(record.config.name),
  path: text(record.config.path),
  bodyHash: text(record.config.bodyHash),
  ...(text(record.config.missingSince) ? { missingSince: text(record.config.missingSince) } : {}),
})

export const newAgentId = () => `cc:${randomUUID()}`

/** The notice ref of an agent: its catalog key is its name; its identity rides along. */
const refOf = (group: BindingGroup, name: string, id: string) => ({
  id: name,
  scope: group.projectId || SEMANTIC_GLOBAL_SCOPE,
  agentId: id,
})

/**
 * Reads agent definitions where Claude Code keeps them and ties each to a stable id. Every read
 * reconciles first, so a file made or renamed outside Localix has its binding by the time anyone
 * asks; the watcher only makes that happen sooner and keeps the grace clock honest. A change is
 * written with its notice in one transaction (C1).
 */
export function createAgentBindings(deps: BindingDeps) {
  const serialize = createKeyedSerializer()
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? newAgentId

  async function apply(userId: string, plan: BindingPlan): Promise<void> {
    if (!plan.create.length && !plan.update.length && !plan.missing.length && !plan.purge.length)
      return
    const stamp = new Date(now()).toISOString()
    await deps.db.transaction().execute(async (trx) => {
      const sources = deps.stores.sources(trx, 'agent')
      const rules = deps.stores.rules(trx)
      const changes: CoreChange[] = []
      const config = (found: FoundAgent) => ({
        name: found.name,
        path: found.path,
        bodyHash: found.bodyHash,
      })
      for (const { found, id } of plan.create) {
        // A plugin's agent also has its own plugin on: run as a child, its rules are the whole
        // policy, and its plugin off there would leave it without its own skills and hooks.
        const plugin = found.source.startsWith('plugin:') ? found.source.slice(7) : undefined
        const preset = inheritedAgentPreset(id)
        await rules.replace(
          userId,
          id,
          plugin ? applySwitches(preset, 'plugin', [{ name: plugin, enabled: true }]) : preset,
        )
        await sources.upsert(userId, found.projectId, id, {
          source: found.source,
          config: config(found),
        })
        changes.push({ entity: 'agent', op: 'upserted', ref: refOf(found, found.name, id) })
      }
      for (const { row, found, renamed } of plan.update) {
        await sources.patchConfig(userId, row.projectId, row.id, {
          ...config(found),
          missingSince: null,
        })
        if (renamed)
          changes.push({ entity: 'agent', op: 'deleted', ref: refOf(row, row.name, row.id) })
        changes.push({ entity: 'agent', op: 'upserted', ref: refOf(row, found.name, row.id) })
      }
      for (const row of plan.missing) {
        await sources.patchConfig(userId, row.projectId, row.id, { missingSince: stamp })
        changes.push({ entity: 'agent', op: 'upserted', ref: refOf(row, row.name, row.id) })
      }
      for (const row of plan.purge) {
        await sources.remove(userId, row.projectId, row.id)
        changes.push({ entity: 'agent', op: 'deleted', ref: refOf(row, row.name, row.id) })
      }
      await recordCoreChanges(trx, changes)
    })
    deps.onChanged?.()
  }

  /** One scope: read, plan, write what changed, and answer with every definition's id. */
  async function reconcile(userId: string, projectId: string): Promise<AgentSnapshot> {
    const scope = await deps.catalog(userId, projectId)
    const rows = (await deps.stores.sources(deps.db, 'agent').listForScope(userId, projectId))
      .filter((record) => !record.name.startsWith('builtin:'))
      .map(toBoundRow)

    const scanned = new Set([
      groupKey({ projectId: '', source: 'managed' }),
      groupKey({ projectId: '', source: 'user' }),
      groupKey({ projectId: '', source: 'flag' }),
      ...(projectId && scope.projectReadable ? [groupKey({ projectId, source: 'project' })] : []),
    ])
    const installed = new Set<string>()
    for (const group of scope.plugins) {
      const key = groupKey({ projectId: group.projectId, source: `plugin:${group.plugin}` })
      installed.add(key)
      if (group.enabled) scanned.add(key)
    }
    const catalog = composeCatalog(scope, projectId)
    const found: FoundAgent[] = catalog.found.map((agent) => ({
      projectId: agent.projectId,
      source: sourceKeyOf(agent),
      name: agent.name,
      path: agentFileOf(agent),
      bodyHash: agent.bodyHash,
    }))
    // A plugin that is no longer installed and a row of the retired registry are gone for good.
    const gone = new Set<string>()
    for (const row of rows) {
      const plugin = row.source.startsWith('plugin:')
      if (plugin ? !installed.has(groupKey(row)) : !READ_SOURCES.has(row.source))
        gone.add(groupKey(row))
    }

    const plan = planBindings({ rows, found, scanned, gone, now: now(), newId })
    await apply(userId, plan)

    const bound = (agent: CatalogAgent, id: string): BoundAgent => {
      const shadowedBy = catalog.shadowedBy(agent)
      return { id, agent, ...(shadowedBy ? { shadowedBy } : {}) }
    }
    const purged = new Set(plan.purge.map((row) => row.id))
    const waiting = rows
      .filter((row) => row.missingSince !== undefined && !purged.has(row.id))
      .map((row) => Date.parse(row.missingSince!))
    if (plan.missing.length > 0) waiting.push(now())
    return {
      resolve: catalog.resolve,
      main: catalog.main,
      agents: [
        ...catalog.found.map((agent, index) => bound(agent, plan.ids.get(found[index]!)!)),
        ...catalog.builtins.map((agent) => bound(agent, builtinAgentId(agent.name))),
      ],
      watch: scope.agents.watch,
      purgeDueAt: waiting.length > 0 ? Math.min(...waiting) + GRACE_MS : null,
    }
  }

  /**
   * An agent deleted on purpose is purged now, not after the grace window that protects a file a
   * checkout removed for a moment: its row's wait is marked over, and the reconcile that follows
   * removes the row and announces the deletion. Call it after the file is gone.
   */
  async function forget(userId: string, scope: string, ownerProjectId: string, id: string) {
    await deps.stores
      .sources(deps.db, 'agent')
      .patchConfig(userId, ownerProjectId, id, { missingSince: new Date(0).toISOString() })
    return reconcile(userId, scope)
  }

  return {
    forget,
    /** The scope's definitions with their ids, after reconciling the bindings. */
    snapshot: (userId: string, projectId: string) =>
      serialize(userId, () => reconcile(userId, projectId)),
    /** The same without the lock, for work already inside `exclusive`. */
    reconcileNow: reconcile,
    /** Run `work` while no reconcile can interleave: a write that reserves a binding uses this. */
    exclusive: <T>(userId: string, work: () => Promise<T>) => serialize(userId, work),
  }
}

export type AgentBindings = ReturnType<typeof createAgentBindings>
