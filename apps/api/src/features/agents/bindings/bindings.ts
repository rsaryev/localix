import { randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import { SEMANTIC_GLOBAL_SCOPE } from '@localixai/mini-app-sdk/backend'
import { builtinAgentId } from '@localixai/agent/agents'
import type { AppDatabase } from '../../../db/types'
import { createKeyedSerializer } from '../../../lib/keyed-serializer'
import { inheritedAgentPreset } from '../../capabilities/builtin-agent-presets'
import type { CapabilitySourceRecord } from '../../capabilities/source-repository'
import type { CapabilityStores } from '../../capabilities/store-factory'
import { recordCoreChanges, type CoreChange } from '../../changes/core-entities'
import type { LoadedPluginAgent } from '../../plugins/loader-contract'
import type { CatalogAgent } from '../catalog/agent-file'
import { composeCatalog, type AgentCatalog } from '../catalog/catalog'
import { BUILTIN_AGENT_TYPES } from '../catalog/builtin-types'
import { pluginCatalogAgent, scanFileAgents, type AgentFolders } from '../catalog/scan'
import {
  GRACE_MS,
  groupKey,
  planBindings,
  type BindingGroup,
  type BindingPlan,
  type BoundRow,
  type FoundAgent,
} from './plan'

/** The agents a plugin brings, with whether the plugin is on: an installed plugin is never gone. */
export interface PluginAgentGroup {
  plugin: string
  /** '' for a plugin installed for the person; else the project it is installed for. */
  projectId: string
  enabled: boolean
  agents: readonly LoadedPluginAgent[]
}

export interface BindingDeps {
  db: Kysely<AppDatabase>
  stores: CapabilityStores
  /** Claude Code's folders for a scope (`project` null when the folder cannot be read now). */
  folders(userId: string, projectId: string): Promise<AgentFolders>
  plugins?(userId: string, projectId: string): Promise<readonly PluginAgentGroup[]>
  now?: () => number
  newId?: () => string
}

/** A definition with the identity Localix keeps for it. */
export interface BoundAgent {
  id: string
  agent: CatalogAgent
  shadowedBy?: CatalogAgent
}

export interface AgentSnapshot {
  catalog: AgentCatalog
  agents: readonly BoundAgent[]
  /** When the first missing definition of this scope is due to be purged, or null. */
  purgeDueAt: number | null
}

const FILE_SOURCES = new Set(['user', 'project', 'managed'])
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

const sourceOf = (agent: CatalogAgent): string =>
  agent.source === 'plugin' ? `plugin:${agent.pluginName}` : agent.source

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
        await rules.replace(userId, id, inheritedAgentPreset(id))
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
  }

  /** One scope: scan, plan, write what changed, and answer with every definition's id. */
  async function reconcile(userId: string, projectId: string): Promise<AgentSnapshot> {
    const folders = await deps.folders(userId, projectId)
    const plugins = (await deps.plugins?.(userId, projectId)) ?? []
    const rows = (await deps.stores.sources(deps.db, 'agent').listForScope(userId, projectId))
      .filter((record) => !record.name.startsWith('builtin:'))
      .map(toBoundRow)

    const scanned = new Set([
      groupKey({ projectId: '', source: 'managed' }),
      groupKey({ projectId: '', source: 'user' }),
      ...(projectId && folders.project ? [groupKey({ projectId, source: 'project' })] : []),
    ])
    const ordered: CatalogAgent[] = await scanFileAgents(folders, projectId)
    const installed = new Set<string>()
    for (const group of plugins) {
      const source = `plugin:${group.plugin}`
      installed.add(groupKey({ projectId: group.projectId, source }))
      if (!group.enabled) continue
      scanned.add(groupKey({ projectId: group.projectId, source }))
      ordered.push(...group.agents.map((agent) => pluginCatalogAgent(agent, group.projectId)))
    }
    const found: FoundAgent[] = ordered.map((agent) => ({
      projectId: agent.projectId,
      source: sourceOf(agent),
      name: agent.fullName,
      path: agent.path,
      bodyHash: agent.bodyHash,
    }))
    // A plugin that is no longer installed and a row of the retired registry are gone for good.
    const gone = new Set<string>()
    for (const row of rows) {
      const plugin = row.source.startsWith('plugin:')
      if (plugin ? !installed.has(groupKey(row)) : !FILE_SOURCES.has(row.source))
        gone.add(groupKey(row))
    }

    const plan = planBindings({ rows, found, scanned, gone, now: now(), newId })
    await apply(userId, plan)

    const catalog = composeCatalog([...ordered, ...BUILTIN_AGENT_TYPES])
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
      catalog,
      agents: [
        ...ordered.map((agent, index) => bound(agent, plan.ids.get(found[index]!)!)),
        ...BUILTIN_AGENT_TYPES.map((agent) => bound(agent, builtinAgentId(agent.name))),
      ],
      purgeDueAt: waiting.length > 0 ? Math.min(...waiting) + GRACE_MS : null,
    }
  }

  return {
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
