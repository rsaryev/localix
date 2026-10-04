/**
 * Which conversation's WORKSPACE a session shows in: its root conversation.
 *
 * The defect this stops: every workbench surface (the grid's tabs, the Browser strip, the reveal
 * rules) was keyed by the session id itself, so a sub-session — a delegated agent, a thread, a
 * fork — had a workspace of its own. Stepping from a parent into its sub-session swapped the whole
 * workbench, and what the sub-session opened was out of sight from its parent. A sub-session of
 * any kind has no workspace: it works in its root's. Someone who wants a separate workspace starts
 * a new conversation.
 *
 * Ownership is not this: a sub-session still OWNS what it opened (the server's boundaries, the
 * agent's own tabs to close). Only where things are SHOWN folds to the root.
 *
 * The chat store knows the session tree and registers the answer; this module knows nothing about
 * sessions, so the grid and the Browser can fold through it without importing chat. Until it is
 * registered every session is its own root.
 */
let rootOf: (sessionId: string) => string | null | undefined = () => null

export function setWorkspaceResolver(resolve: (sessionId: string) => string | null | undefined) {
  rootOf = resolve
}

export function workspaceOf(sessionId: string): string {
  return rootOf(sessionId) || sessionId
}

/** Whether a session is a sub-session: it has a root other than itself. */
export const isSubSession = (sessionId: string): boolean => workspaceOf(sessionId) !== sessionId

/** Whether two sessions work in one workspace. */
export const sameWorkspace = (a: string | null, b: string | null): boolean =>
  !!a && !!b && workspaceOf(a) === workspaceOf(b)

/**
 * What an open by `opener` may do to the screen while `active` is the conversation being read —
 * the one rule every reveal asks.
 *
 *   focus — the opener IS the conversation on screen: its tab may come forward;
 *   quiet — another conversation of the same workspace (a sub-agent working beside its parent,
 *           or the parent while you read a sub-session): the tab joins the workspace unfocused.
 *           Several sub-agents at once would otherwise take turns pulling the workbench away;
 *   none  — another workspace: it waits there for its own conversation.
 */
export type OpenPolicy = 'focus' | 'quiet' | 'none'

export function openPolicy(active: string | null, opener: string): OpenPolicy {
  if (active === opener) return 'focus'
  return sameWorkspace(active, opener) ? 'quiet' : 'none'
}
