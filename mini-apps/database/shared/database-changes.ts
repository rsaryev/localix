/**
 * What the agent's `database_client` tool changed, announced to this mini app's UI.
 *
 * The defect it stops: the tool writes on the server — a connection saved, a table created, rows
 * inserted — and the workbench, which learns of its own writes from its own calls, did not learn
 * of these at all. The schema tree kept its old tables and an open table page its old rows until
 * someone clicked refresh. Polling cannot close that gap for schemas and rows: it would introspect
 * and re-query the user's real database every few seconds to find out nothing moved.
 *
 * So the tool says what moved, once, on the mini app command bus (the API client's shape): the
 * backend emits a {@link DatabaseChange} after a successful write, the UI re-reads exactly that.
 * One value both sides import, so the name and the shape cannot drift apart.
 */
export const DATABASE_MINI_APP = 'database'
export const DATABASE_CHANGES_CHANNEL = 'changes'

export type DatabaseChange =
  /** The saved-connection list or a connection's live state. */
  | { type: 'connections' }
  /** A connection's schema (tables, columns). No id: the call named no connection. */
  | { type: 'schema'; connectionId?: string }
  /** Rows in a connection's objects. No id: the call named no connection. */
  | { type: 'data'; connectionId?: string }

/** The payload as a {@link DatabaseChange}, or null — a frame from anywhere else is ignored. */
export function parseDatabaseChange(value: unknown): DatabaseChange | null {
  if (!value || typeof value !== 'object') return null
  const { type, connectionId } = value as { type?: unknown; connectionId?: unknown }
  if (type === 'connections') return { type }
  if (type !== 'schema' && type !== 'data') return null
  if (connectionId === undefined) return { type }
  return typeof connectionId === 'string' && connectionId !== '' ? { type, connectionId } : null
}
