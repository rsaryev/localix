import type { ConnectionPool } from './mcp-connection-pool'
import { mcpConnectionKey } from './mcp-connection-key'
import type { McpPromptDef, McpPromptResult, McpServerPrompt } from './mcp-prompts'
import type { McpServerRecord } from './repository'

/**
 * The prompts of live connections, read from the pool's cache: nothing here connects, so a menu
 * can ask on every keystroke. A server that is not connected (or whose connection broke) lists
 * none until a run, a probe or `/mcp reconnect` connects it.
 */
export function cachedPrompts(
  pool: Pick<ConnectionPool, 'cache'>,
  servers: readonly McpServerRecord[],
  cwd: string,
): McpServerPrompt[] {
  return servers.flatMap((server) => {
    const entry = pool.cache.get(mcpConnectionKey(server, cwd))
    const connection = entry?.connection
    if (!connection || entry.broken) return []
    return connection.prompts.map((prompt) => ({
      server: server.name,
      serverId: server.id,
      prompt,
    }))
  })
}

/** `prompts/get` on the server's shared connection (connecting if it is not yet). */
export async function getPrompt(
  pool: Pick<ConnectionPool, 'acquire'>,
  server: McpServerRecord,
  cwd: string,
  name: string,
  args: Record<string, string>,
): Promise<McpPromptResult> {
  const { connection } = await pool.acquire(server, cwd)
  if (!connection.client.getPrompt) throw new Error(`MCP server "${server.name}" has no prompts`)
  return connection.client.getPrompt({ name, arguments: args })
}

/** The prompts of one server, connecting it if it is not yet (a typed command, not a menu). */
export async function promptsOf(
  pool: Pick<ConnectionPool, 'acquire'>,
  server: McpServerRecord,
  cwd: string,
): Promise<McpPromptDef[]> {
  const { connection } = await pool.acquire(server, cwd)
  return connection.prompts
}
