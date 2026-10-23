/**
 * AGENT SEATS — a reactor on the core change feed.
 *
 * A seat names its agent by stable id and keeps the handle as a display snapshot. When the agent
 * is renamed, the snapshot follows; when it is deleted, it leaves the rooms it shared, its entries
 * in the choice maps go (they were its "recent" model) and its remembered model parameters go.
 *
 * Only an explicit deletion notice whose agent can no longer be found removes anything. A resync
 * (files edited, a plugin toggled) and the reconcile only repair handles: an agent that is
 * missing because its plugin is switched off must keep its seats for when it comes back.
 */
import type { ConsumerHandlers, EntityRef } from '@localixai/change-feed'

import type { CoreCascades, CoreRefs } from '../../changes/core-entities'
import type { RealtimeResource } from '../../realtime/resources'
import type { AgentSeatsRepository } from './seats-repository'

export interface AgentSeatsPorts {
  seats: AgentSeatsRepository
  /** Every agent a project sees (`''` = installation), by id → its current handle. */
  handles(projectId: string): Promise<ReadonlyMap<string, string>>
  /** Forget what the person tuned for this agent's models (user settings). */
  forgetModelSettings(agentId: string): Promise<void>
  publish(resources: RealtimeResource[]): void
}

type AgentRef = EntityRef<CoreRefs, 'agent'>

export function createAgentSeats(ports: AgentSeatsPorts) {
  const projectOf = (ref: AgentRef) => (ref.scope === 'global' ? '' : ref.scope)

  const renamed = async (agentId: string, handle: string | undefined) =>
    Boolean(handle) && (await ports.seats.rename(agentId, handle!)).length > 0

  async function changed(op: 'upserted' | 'deleted', ref: AgentRef): Promise<void> {
    if (!ref.agentId) return
    const handle = (await ports.handles(projectOf(ref))).get(ref.agentId)
    if (await renamed(ref.agentId, handle)) ports.publish(['sessions'])
    if (op !== 'deleted' || handle) return
    const left = await ports.seats.leaveRooms(ref.agentId)
    const forgot = await ports.seats.forgetChoices(ref.agentId)
    await ports.forgetModelSettings(ref.agentId)
    if (left.length + forgot.length > 0) ports.publish(['sessions'])
  }

  /** Bring every seat's handle up to date. Never removes a seat. */
  async function reconcile(): Promise<void> {
    const views = new Map<string, Promise<ReadonlyMap<string, string>>>()
    let moved = false
    for (const seat of await ports.seats.seats()) {
      let view = views.get(seat.projectId)
      if (!view) views.set(seat.projectId, (view = ports.handles(seat.projectId)))
      const handle = (await view).get(seat.agentId)
      if (handle && handle !== seat.handle && (await renamed(seat.agentId, handle))) moved = true
    }
    if (moved) ports.publish(['sessions'])
  }

  const handlers: ConsumerHandlers<CoreRefs, CoreCascades> = {
    'chat.session': 'ignore',
    'chat.message': 'ignore',
    skill: 'ignore',
    plugin: 'ignore',
    'mini-app': 'ignore',
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
