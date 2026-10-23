export interface AgentDatabaseConnection {
  id: string
  name: string
  dialect: string
  connected: boolean
  readonly: boolean
}

export type AgentConnectionResolution =
  | { ok: true; target: AgentDatabaseConnection }
  | { ok: false; error: string }

/** One canonical ambiguity/availability policy shared by tools that operate on a
 * single live database. */
export function resolveAgentDatabaseConnection(
  connections: AgentDatabaseConnection[],
  requestedId?: string,
): AgentConnectionResolution {
  const live = connections.filter((connection) => connection.connected)
  if (live.length === 0) {
    return {
      ok: false,
      error:
        'No database is connected. See saved ones with action="connections" and reopen one with action="reconnect", or add one with action="connect".',
    }
  }
  if (requestedId) {
    const target = live.find((connection) => connection.id === requestedId)
    if (target) return { ok: true, target }
    return {
      ok: false,
      error: `No connected database with id "${requestedId}". Connected: ${live
        .map((connection) => `${connection.name} (${connection.id})`)
        .join(', ')}.`,
    }
  }
  if (live.length === 1) return { ok: true, target: live[0]! }
  return {
    ok: false,
    error: `Multiple databases are connected — pass connection_id. Options: ${live
      .map((connection) => `${connection.name} [${connection.dialect}] (${connection.id})`)
      .join(', ')}.`,
  }
}
