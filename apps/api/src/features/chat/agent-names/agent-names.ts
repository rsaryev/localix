/**
 * AGENT ROUTES — a reactor on the core change feed.
 *
 * A session names its agent by stable id and keeps the name as a display snapshot. When the
 * agent is renamed, the snapshot follows; when it is deleted, its remembered model parameters go.
 *
 * Only an explicit deletion notice whose agent can no longer be found removes anything, and a
 * resync does the same for ids that have no binding row at all (a purge this reactor never saw).
 * Names are repaired either way: an agent that is missing because its plugin is switched off
 * keeps its binding, so its sessions keep it for when it comes back.
 */
import type { ConsumerHandlers, EntityRef } from '@localixai/change-feed'

import type { CoreCascades, CoreRefs } from '../../changes/core-entities'
import type { RealtimeResource } from '../../realtime/resources'
import type { AgentNamesRepository } from './names-repository'

export interface AgentNamesPorts {
  sessions: AgentNamesRepository
  /** Every agent a project sees (`''` = installation), by id → its current name. */
  names(projectId: string): Promise<ReadonlyMap<string, string>>
  /** Whether the agent has a binding row: a built-in, or a file or plugin definition not purged. */
  bound(agentId: string): Promise<boolean>
  /** Forget what the person tuned for this agent's models (user settings). */
  forgetModelSettings(agentId: string): Promise<void>
  publish(resources: RealtimeResource[]): void
}

type AgentRef = EntityRef<CoreRefs, 'agent'>

export function createAgentNames(ports: AgentNamesPorts) {
  const projectOf = (ref: AgentRef) => (ref.scope === 'global' ? '' : ref.scope)

  const renamed = async (agentId: string, name: string | undefined) =>
    Boolean(name) && (await ports.sessions.rename(agentId, name!)).length > 0

  async function changed(op: 'upserted' | 'deleted', ref: AgentRef): Promise<void> {
    if (!ref.agentId) return
    const name = (await ports.names(projectOf(ref))).get(ref.agentId)
    if (await renamed(ref.agentId, name)) ports.publish(['sessions'])
    if (op !== 'deleted' || name) return
    await forget(ref.agentId)
  }

  async function forget(agentId: string): Promise<void> {
    await ports.forgetModelSettings(agentId)
  }

  /** Bring every route's name up to date, and let go of ids that have no row anywhere. */
  async function reconcile(): Promise<void> {
    const views = new Map<string, Promise<ReadonlyMap<string, string>>>()
    let moved = false
    const orphans = new Set<string>()
    for (const ref of await ports.sessions.sessionAgents()) {
      let view = views.get(ref.projectId)
      if (!view) views.set(ref.projectId, (view = ports.names(ref.projectId)))
      const name = (await view).get(ref.agentId)
      if (name && name !== ref.name && (await renamed(ref.agentId, name))) moved = true
      if (!name && !orphans.has(ref.agentId) && !(await ports.bound(ref.agentId)))
        orphans.add(ref.agentId)
    }
    if (moved) ports.publish(['sessions'])
    for (const agentId of orphans) await forget(agentId)
  }

  const handlers: ConsumerHandlers<CoreRefs, CoreCascades> = {
    'chat.session': 'ignore',
    'chat.message': 'ignore',
    skill: 'ignore',
    plugin: 'ignore',
    'mini-app': 'ignore',
    'mini-app.catalog': 'ignore',
    mcp: 'ignore',
    agent: (change) => (change.op === 'resync' ? reconcile() : changed(change.op, change.ref)),
    project: 'ignore',
    'capability.rule': 'ignore',
    'local.model': 'ignore',
    'project.settings': 'ignore',
    'user.profile': 'ignore',
    'user.agent-settings': 'ignore',
    'user.view-state': 'ignore',
    secret: 'ignore',
    'system.toggle': 'ignore',
    'provider.connection': 'ignore',
  }

  return { handlers, reconcile }
}
