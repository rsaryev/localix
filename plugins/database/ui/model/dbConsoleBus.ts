/**
 * One-way command channel from the Database SIDEBAR view to an open SQL-console
 * grid tab, addressed by `connectionId`.
 *
 * The connections list + schema browser live in the left sidebar, while each SQL
 * console is a center editor-grid tab.
 * They live in separate React trees and must not import each other, so the sidebar
 * asks the matching console to "open this table" / "insert this column" through this
 * shared module — the same one-directional shape as `inspectorBus`.
 *
 * A command sent while the target console has no live subscriber (the tab was just
 * opened and hasn't mounted yet) is buffered per connection and drained on the next
 * subscribe, so opening a table in a fresh console isn't lost to the mount race.
 *
 * Addressed by CHAT and connection. A console is a session tab, so two chats can each hold one
 * for the same connection; keyed by connection alone, "open this query" from chat A also replaced
 * the draft in chat B's console, kept warm in the background.
 */

export type DbConsoleCommand =
  | { kind: 'open-table'; table: string; schema?: string }
  | { kind: 'insert-column'; column: string }
  | { kind: 'set-query'; sql: string }

type Listener = (cmd: DbConsoleCommand) => void

const listeners = new Map<string, Set<Listener>>()
const pending = new Map<string, DbConsoleCommand>()

const keyOf = (sessionId: string, connectionId: string) => `${sessionId}\u0000${connectionId}`

export const dbConsoleBus = {
  /** Ask the chat's console bound to `connectionId` to run a command. Buffered if none is live. */
  send(sessionId: string, connectionId: string, cmd: DbConsoleCommand): void {
    const key = keyOf(sessionId, connectionId)
    const set = listeners.get(key)
    if (set && set.size > 0) {
      set.forEach((l) => l(cmd))
      return
    }
    pending.set(key, cmd)
  },
  /** A console tab subscribes for its own chat and connection; drains any buffered command. */
  subscribe(sessionId: string, connectionId: string, listener: Listener): () => void {
    const key = keyOf(sessionId, connectionId)
    let set = listeners.get(key)
    if (!set) {
      set = new Set()
      listeners.set(key, set)
    }
    set.add(listener)
    const buffered = pending.get(key)
    if (buffered) {
      pending.delete(key)
      listener(buffered)
    }
    return () => {
      set!.delete(listener)
      if (set!.size === 0) listeners.delete(key)
    }
  },
}
