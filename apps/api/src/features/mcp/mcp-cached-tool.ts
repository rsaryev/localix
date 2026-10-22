import type { AgentTool } from '@localixai/agent/agents'
import { errorMessage } from '../../lib/errors'
import type { McpServerRecord } from './repository'
import { buildToolForServer, filterToolDefs, type McpClientLike, type McpToolDef } from './mcp-wire'
import { capMcpErrorMessage, resolveMcpResultMaxChars } from './mcp-result'
import type { AcquiredConnection, ConnectionPool } from './mcp-connection-pool'
import type { McpLogger } from './client-manager-types'

const descriptorClient: McpClientLike = {
  async listTools() {
    return { tools: [] }
  },
  async callTool() {
    throw new Error('cached MCP descriptor executed without acquiring its live server')
  },
  async close() {},
}

/** A lazy tool built from persisted metadata; it starts its server on first execute. */
export function buildCachedToolForServer(
  pool: Pick<ConnectionPool, 'acquire'>,
  server: McpServerRecord,
  cwd: string,
  cachedDef: McpToolDef,
  logger?: McpLogger,
): AgentTool {
  const descriptor = buildToolForServer(server, descriptorClient, cachedDef)

  return {
    ...descriptor,
    /**
     * Starting the server from inside the tool handler is only safe if the start is
     * idempotent. `acquire` is this
     * manager's idempotent, single-flight equivalent: concurrent first calls share one start,
     * and a rejected start is evicted so the next call can retry.
     */
    async execute(toolCallId, input, signal, onUpdate, context) {
      let acquired: AcquiredConnection
      try {
        acquired = await pool.acquire(server, cwd, logger)
      } catch (err) {
        const maxResultChars = resolveMcpResultMaxChars(cachedDef.maxResultChars)
        const message = capMcpErrorMessage(errorMessage(err), maxResultChars)
        return {
          content: `MCP tool "${cachedDef.name}" failed to start server "${server.name}": ${message}`,
          isError: true,
          error: {
            kind: 'execution',
            message,
            userMessage: `MCP server "${server.name}" failed to start: ${message}`,
            retryable: true,
            fatal: false,
          },
        }
      }

      // A cached descriptor is only an offer to the model, never authority to dispatch.
      // Reconciliation has completed inside `acquire`; resolve the definition from the LIVE
      // list so removed/UI-only/disabled tools fail clearly and changed metadata governs calls.
      // Policy is not re-checked here: the permission gate judges every call against the
      // composed rules, and this list exists to prove the tool still EXISTS on the server.
      const liveDef = filterToolDefs(acquired.connection.toolDefs).find(
        (def) => def.name === cachedDef.name,
      )
      if (!liveDef) {
        const message =
          `cached MCP tool "${cachedDef.name}" is no longer available on server ` +
          `"${server.name}" after reconciling its live tool list`
        return {
          content: message,
          isError: true,
          error: {
            kind: 'execution',
            message,
            userMessage: message,
            retryable: false,
            fatal: false,
          },
        }
      }

      return buildToolForServer(server, acquired.connection.client, liveDef, () => {
        acquired.entry.broken = true
      }).execute(toolCallId, input, signal, onUpdate, context)
    },
  }
}
