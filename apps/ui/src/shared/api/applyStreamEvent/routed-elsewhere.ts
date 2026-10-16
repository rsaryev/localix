/**
 * Carried by the union, but NOT session state. Each of these is consumed somewhere ELSE, so this
 * reducer deliberately leaves the session untouched. They still get a handler, written here where
 * the next reader of the reducer sees the decision, because an opcode with no handler would fail
 * the exhaustive map in `../applyStreamEvent.ts` and the stream-contract guard.
 *
 *   child_session.*   → `store.ts` `_applyStreamEvent` short-circuits these into the sub-session
 *                       list before this reducer is ever called.
 *   plugin.command / preview.* / fs.changed / terminal.opened
 *                     → `agent-runtime.ts` `handleSessionEvent` routes these to their buses
 *                       (`sessionEventRouters.ts`) and returns before reaching the store.
 *   terminal.state    → `agent-runtime.ts` hands it to the terminal feature's state store
 *                       (`features/terminal/model/terminalStates.ts`) and returns.
 *   user.mentioned    → nothing here: the server lists the waiting question in its attention
 *                       roster (`attention.updated`) and journals the notification. The durable
 *                       fact is already on the message row this frame points at (`to: 'user'`),
 *                       which arrived with its own `message.updated`.
 *   resources.changed → app-level resource sync invalidates the affected read models.
 *   session.deleted   → the chat store removes rows and releases window-owned state.
 *   attention.updated → `agent-runtime.ts` replaces the user-wide attention roster
 *                       (`features/chat/model/attention/store.ts`) and returns before the store.
 *   plan.presented    → `agent-runtime.ts` opens the plan tab (`features/chat/model/plans.ts`
 *                       `routePlanPresented`) and returns before the store: a cue, not state —
 *                       the versions arrive as `plan.updated`.
 */
import type { UiSession } from '../contracts'
import type { StreamReducers } from './types'

const untouched = (session: UiSession): UiSession => session

export const routedElsewhereReducers: StreamReducers<
  | 'session.deleted'
  | 'resources.changed'
  | 'child_session.updated'
  | 'child_session.activity'
  | 'plugin.command'
  | 'preview.updated'
  | 'preview.command'
  | 'preview.closed'
  | 'fs.changed'
  | 'terminal.opened'
  | 'terminal.state'
  | 'user.mentioned'
  | 'attention.updated'
  | 'plan.presented'
> = {
  'session.deleted': untouched,
  'resources.changed': untouched,
  'child_session.updated': untouched,
  'child_session.activity': untouched,
  'plugin.command': untouched,
  'preview.updated': untouched,
  'preview.command': untouched,
  'preview.closed': untouched,
  'fs.changed': untouched,
  'terminal.opened': untouched,
  'terminal.state': untouched,
  'user.mentioned': untouched,
  'attention.updated': untouched,
  'plan.presented': untouched,
}
