import type { ConsumerHandlers } from '@localixai/change-feed'

import type { CoreCascades, CoreRefs } from '../../changes/core-entities'
import type { StatusLine } from './status-line'

/**
 * Claude Code's `statusLine` as a projector on the core change feed: it redraws when its
 * conversation changes — a message, a mode or model change — as Claude Code re-runs it on a new
 * assistant message and a permission mode change. Idempotent: a burst of notices is one draw.
 */
export function createStatusLineChanges(line: StatusLine) {
  const handlers: ConsumerHandlers<CoreRefs, CoreCascades> = {
    'chat.session': (change) => {
      if (change.op === 'resync') return line.refreshAll()
      if (change.op === 'deleted') return line.deleted(change.ref.userId, change.ref.id)
      return line.changed(change.ref.userId, change.ref.id)
    },
    'chat.message': (change) => {
      if (change.op === 'resync') return line.refreshAll()
      if (change.op === 'parent-deleted') return
      return line.changed(change.ref.userId, change.ref.sessionId)
    },
    plugin: 'ignore',
    'mini-app': 'ignore',
    'mini-app.catalog': 'ignore',
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
  return { handlers, reconcile: async () => line.refreshAll() }
}
