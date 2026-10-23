/**
 * The permission class of one `kanban` call.
 *
 * The yes/no it replaces called every edit a `write`, the class a read-only plan session
 * refuses — yet a card lives on this chat's board and is deleted with the chat, so planning work
 * on the board is exactly what such a session is for. Edits are `session`; `delete` also cannot
 * be undone. The table is keyed by `KanbanAction`, so an action added to the enum without a
 * class here fails `tsc`, and an action outside the enum answers `external`.
 */

import { classifyByAction, type CallClass } from '@localixai/mini-app-sdk/backend'
import type { KanbanAction } from '../shared/tool'

const SESSION: CallClass = { effect: 'session' }

const KANBAN_CALL_CLASSES: Record<KanbanAction, CallClass> = {
  list: { effect: 'read' },
  search: { effect: 'read' },
  detail: { effect: 'read' },
  create: SESSION,
  update: SESSION,
  take: SESSION,
  complete: SESSION,
  block: SESSION,
  reorder: SESSION,
  delete: { effect: 'session', irreversible: true },
}

export const classifyKanbanCall = classifyByAction(KANBAN_CALL_CLASSES)
