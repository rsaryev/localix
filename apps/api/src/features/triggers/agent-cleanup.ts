/**
 * TRIGGERS OF AN AGENT THAT IS GONE — a reactor on the core change feed.
 *
 * A loop armed by an agent wakes its chat addressed to that agent. Once the agent is purged its
 * file is gone for good, so every fire would find nobody: the loops stop (their records stay as
 * history) and the person is told. A purge is a `deleted` notice whose id has no binding row any
 * more; a rename is the same notice while the row is still there and stops nothing. A `resync`
 * stops the orphans a purge notice never reached.
 */
import type { ConsumerHandlers } from '@localixai/change-feed'

import type { CoreCascades, CoreRefs } from '../changes/core-entities'
import type { TriggerRecord } from './contracts'

export interface AgentTriggerPorts {
  /** Every trigger that has not ended. */
  live(): readonly TriggerRecord[]
  end(id: string, reason: string): Promise<unknown>
  /** Whether the agent has a binding row, or is a built-in. */
  bound(agentId: string): Promise<boolean>
  /** Tell the person this trigger stopped because its agent is gone. */
  ownerGone(trigger: TriggerRecord): void
}

export const AGENT_GONE_REASON = 'agent-removed'

export function createAgentTriggerCleanup(ports: AgentTriggerPorts) {
  const ownedBy = (trigger: TriggerRecord) =>
    trigger.owner.kind === 'agent' ? trigger.owner.agentId : undefined

  async function stop(match: (agentId: string) => Promise<boolean>): Promise<void> {
    for (const trigger of ports.live()) {
      const agentId = ownedBy(trigger)
      if (!agentId || !(await match(agentId))) continue
      await ports.end(trigger.id, AGENT_GONE_REASON)
      ports.ownerGone(trigger)
    }
  }

  const unbound = async (agentId: string) =>
    !agentId.startsWith('builtin:') && !(await ports.bound(agentId))

  const handlers: ConsumerHandlers<CoreRefs, CoreCascades> = {
    'chat.session': 'ignore',
    'chat.message': 'ignore',
    skill: 'ignore',
    plugin: 'ignore',
    'mini-app': 'ignore',
    'mini-app.marketplace': 'ignore',
    'mini-app.updates': 'ignore',
    mcp: 'ignore',
    agent: (change) => {
      if (change.op === 'resync') return stop(unbound)
      const purged = change.ref.agentId
      if (change.op !== 'deleted' || !purged) return undefined
      return stop(async (agentId) => agentId === purged && (await unbound(agentId)))
    },
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
  return { handlers, reconcile: () => stop(unbound) }
}
