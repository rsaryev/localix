import { errorMessage } from '../../lib/errors'
import { mcpConnectionKey } from './mcp-connection-key'
import { serverStatusKey, type GatherState, type McpServerOutcome } from './mcp-gather'
import type { McpServerRecord } from './repository'
import { filterToolDefs } from './mcp-tools'

/**
 * `/mcp reconnect`: drop the server's live client (any cwd), connect again now and record the
 * outcome where `/mcp` reads it. The record must be the one a run connects with, so the entry
 * dropped is the one the next run would have reused.
 */
export async function reconnectServer(
  state: GatherState,
  server: McpServerRecord,
  cwd: string,
): Promise<McpServerOutcome> {
  const { pool } = state
  const key = mcpConnectionKey(server, cwd)
  const stale = [...pool.cache.values()].filter(
    (entry) => entry.key === key || entry.serverName === server.name,
  )
  await Promise.all(stale.map((entry) => pool.evict(entry)))
  let outcome: McpServerOutcome
  try {
    const { connection } = await pool.acquire(server, cwd)
    outcome = {
      name: server.name,
      ok: true,
      toolCount: filterToolDefs(connection.toolDefs).length,
      cached: false,
    }
  } catch (err) {
    outcome = {
      name: server.name,
      ok: false,
      toolCount: 0,
      cached: false,
      error: errorMessage(err),
    }
  }
  state.lastStatus?.set(serverStatusKey(server), outcome)
  return outcome
}
