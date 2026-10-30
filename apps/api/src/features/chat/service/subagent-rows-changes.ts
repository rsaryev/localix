import type { ConsumerHandlers } from '@localixai/change-feed'

import type { CoreCascades, CoreRefs } from '../../changes/core-entities'
import type { SubagentRowsLive } from './subagent-rows-live'

/**
 * The subagent rows as a projector on the core change feed: what a row shows comes from its
 * child session (status, title, birth) and its messages (progress, tokens), and both owners
 * record a notice with each write. A plugin moving may set or clear the status line itself.
 *
 * Idempotent: a duplicate notice rides on the redraw already pending, and the redraw pokes only
 * when the rows differ. Its reconcile redraws every conversation it keeps.
 */
export function createSubagentRowsChanges(live: SubagentRowsLive) {
  const handlers: ConsumerHandlers<CoreRefs, CoreCascades> = {
    'chat.session': (change) => {
      if (change.op === 'resync') return live.refreshAll()
      if (change.op === 'deleted') return live.deleted(change.ref.userId, change.ref.id)
      return live.changed(change.ref.userId, change.ref.id, { locate: true })
    },
    'chat.message': (change) => {
      if (change.op === 'resync') return live.refreshAll()
      // Its conversation's own deletion notice redraws (or forgets) the rows.
      if (change.op === 'parent-deleted') return
      return live.changed(change.ref.userId, change.ref.sessionId)
    },
    plugin: () => live.refreshAll(),
    'mini-app': 'ignore',
    'mini-app.marketplace': 'ignore',
    'mini-app.updates': 'ignore',
    skill: 'ignore',
    mcp: 'ignore',
    agent: 'ignore',
    'capability.rule': 'ignore',
    project: 'ignore',
    'local.model': 'ignore',
    'project.settings': 'ignore',
    'user.profile': 'ignore',
    'user.agent-settings': 'ignore',
    'user.view-state': 'ignore',
    secret: 'ignore',
    'system.toggle': 'ignore',
    'provider.connection': 'ignore',
  }
  return { handlers, reconcile: async () => live.refreshAll() }
}
