/**
 * The core's deletions as a mini app hears them (`host.changes.followCoreDeletions`): a read-only
 * consumer on the core stream that hands on agents, chats, projects and provider connections that
 * are gone — their refs only — and ignores everything else.
 *
 * An agent's catalog key is "deleted" on a rename too (`agents/service.ts` records the old key
 * deleted and the new one upserted together). A mini app storing the stable id must not unassign a
 * renamed agent, so an agent deletion is passed on only when no later notice brought its id back.
 */
import type { CoreDeletion } from '@localixai/mini-app-sdk/backend'
import type { ConsumerHandlers } from '@localixai/change-feed'
import type { CoreCascades, CoreChangeFeed, CoreRefs } from './core-entities'

/** Whether an agent's stable id was brought back after its latest deletion (a rename). */
type LivesOn = (agentId: string) => Promise<boolean>

type Handler = (deletion: CoreDeletion) => Promise<void> | void

export function coreDeletionHandlers(
  agentLivesOn: LivesOn,
  handler: Handler,
): ConsumerHandlers<CoreRefs, CoreCascades> {
  return {
    agent: async (change) => {
      if (change.op !== 'deleted') return
      if (change.ref.agentId && (await agentLivesOn(change.ref.agentId))) return
      await handler({ entity: 'agent', ref: change.ref })
    },
    'chat.session': async (change) => {
      if (change.op === 'deleted') await handler({ entity: 'chat', ref: change.ref })
    },
    project: async (change) => {
      if (change.op === 'deleted') await handler({ entity: 'project', ref: change.ref })
    },
    'provider.connection': async (change) => {
      if (change.op === 'deleted') await handler({ entity: 'provider.connection', ref: change.ref })
    },
    'chat.message': 'ignore',
    skill: 'ignore',
    plugin: 'ignore',
    'mini-app': 'ignore',
    'mini-app.marketplace': 'ignore',
    'mini-app.updates': 'ignore',
    mcp: 'ignore',
    'capability.rule': 'ignore',
    'local.model': 'ignore',
    'project.settings': 'ignore',
    'user.profile': 'ignore',
    'user.agent-settings': 'ignore',
    'user.view-state': 'ignore',
    secret: 'ignore',
    'system.toggle': 'ignore',
  }
}

/** One mini app's core consumers, named `mini-app:<app>:<consumer>`; a re-subscribe replaces. */
export function createCoreDeletionFollower(deps: { agentLivesOn: LivesOn; core: CoreChangeFeed }) {
  const running = new Map<string, () => Promise<void>>()
  return async (miniAppName: string, consumer: string, handler: Handler) => {
    const name = `mini-app:${miniAppName}:${consumer}`
    await running.get(name)?.()
    const started = await deps.core.subscribe(
      name,
      coreDeletionHandlers(deps.agentLivesOn, handler),
      {
        kind: 'reactor',
      },
    )
    const stop = async () => {
      if (running.get(name) !== stop) return
      running.delete(name)
      await started.stop()
    }
    running.set(name, stop)
    return stop
  }
}
