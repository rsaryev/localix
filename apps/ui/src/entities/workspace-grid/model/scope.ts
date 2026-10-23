// Scope identity for the scoped grid: every tab belongs to exactly one workspace, named by the id
// of its root conversation (`workspaceOf`; a sub-session has none of its own). The one exception is the reserved GLOBAL_SCOPE, which holds the APP-LEVEL kinds a
// kind declares as such (settings, usage, an agent profile) — never a tab that reads a session.
import type { WorkItemKind } from '@/shared/lib/workItem'
import { isBuiltInWorkItemKind, isSingleton, scopeKindOf } from './capabilities'
import { workspaceOf } from '@/shared/lib/workspaceOf'

/** A scope key: a chat sessionId, or GLOBAL_SCOPE for an app-level kind. */
export type ScopeId = string

/** The reserved scope owning app-level tabs (never a real sessionId). */
export const GLOBAL_SCOPE = '@global'

/**
 * The scope a tab opens in — or `null` when the open names no session for a session kind.
 *
 * The defect this stops: an open that named no session was stamped with whatever chat was on
 * screen, so a file, a preview or a terminal opened on behalf of one chat landed in another, and
 * the singleton panels (Browser, Problems, Activity, Search) followed the active chat instead of
 * belonging to one. Nothing guesses now: an app-level kind lives in GLOBAL_SCOPE, every other kind
 * lives in the session its opener names, and an open that names none is refused by the caller.
 *
 * A session scope is its WORKSPACE (`workspaceOf`): a sub-session's tabs open in its root's, so
 * stepping into it changes the chat, not the workbench around it.
 */
export function resolveOpenScope(kind: WorkItemKind, scope: ScopeId | undefined): ScopeId | null {
  if (scopeKindOf(kind) === 'global') return GLOBAL_SCOPE
  return scope && scope !== GLOBAL_SCOPE ? workspaceOf(scope) : null
}

/** The scope a session shows in — its workspace; GLOBAL stays GLOBAL. */
export const workspaceScope = (scope: ScopeId): ScopeId =>
  scope === GLOBAL_SCOPE ? scope : workspaceOf(scope)

/** The scope of a stored item. Every item is stamped on open; restore drops one that is not. */
export function scopeOf(itemScope: ScopeId | undefined): ScopeId {
  return itemScope ?? GLOBAL_SCOPE
}

/** The session a tab belongs to — `null` for an app-level tab, which belongs to none. */
export function sessionOfScope(itemScope: ScopeId | undefined): string | null {
  const scope = scopeOf(itemScope)
  return scope === GLOBAL_SCOPE ? null : scope
}

/**
 * The id a MINI APP's session-scoped tab takes in its session: `<id>@<session>`.
 *
 * The defect this stops: tabs are de-duplicated by id across every scope, and a mini app opens its
 * tab under a fixed id (the launcher uses the kind itself). Opening it from chat B found chat A's
 * tab and re-stamped it with B's scope, so a session-scoped surface — a game board, a book — left
 * the chat it belonged to and took that chat's state with it. Qualifying the id by its session
 * makes "the board of this chat" one tab per chat, whatever id the opener used.
 *
 * Mini app kinds and core SINGLETONS, only in a session: a singleton (the Browser, Problems,
 * Activity, Search) is one tab per chat, so its fixed id needs the same qualification. Other core
 * kinds keep their own id contracts (a chat tab's id is its session), and an app-level tab has one
 * instance by design. Idempotent, so a restored or re-opened tab keeps the id it already has.
 */
export function tabIdInScope(kind: WorkItemKind, id: string, scope: ScopeId): string {
  if (scope === GLOBAL_SCOPE || (isBuiltInWorkItemKind(kind) && !isSingleton(kind))) return id
  const suffix = `@${scope}`
  return id.endsWith(suffix) ? id : `${id}${suffix}`
}

/** Whether `tabId` is the tab opened as `id` — as it is, or qualified by a session. */
export const isTabOpenedAs = (tabId: string, id: string): boolean =>
  tabId === id || tabId.startsWith(`${id}@`)

/** Is a tab visible while `activeScope` is focused? Global tabs are always visible;
 *  a session-scoped tab only in its own session. Drives the per-session tab filter. */
export function isVisibleInScope(itemScope: ScopeId | undefined, activeScope: ScopeId): boolean {
  const s = scopeOf(itemScope)
  return s === GLOBAL_SCOPE || s === activeScope
}
