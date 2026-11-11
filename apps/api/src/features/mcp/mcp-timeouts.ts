import { claudeCodeMcp } from './claude-code-settings'
import type { McpServerRecord } from './repository'

/**
 * How long an MCP connection and an MCP tool call may take: Claude Code's limits (mcp.md, "Time
 * limits on MCP tool calls"; env-vars.md `MCP_TIMEOUT`, `MCP_TOOL_TIMEOUT`,
 * `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`), decided by the kit (`mcpTimeouts`) through the installed
 * host, read from the API's environment with the folder's Claude Code settings `env` over it.
 */

type Env = Record<string, string | undefined>
type Limited = Pick<McpServerRecord, 'transport' | 'config' | 'settingsEnv'>

/** The environment a server's limits are read from: the API's, the folder's settings over it. */
export function serverEnv(server?: Pick<McpServerRecord, 'settingsEnv'>): Env {
  return server?.settingsEnv ? { ...process.env, ...server.settingsEnv } : process.env
}

/** The limits of `server`; with no server, the limits that hold for any (`MCP_TIMEOUT`). */
export const serverTimeouts = (server?: Limited) =>
  claudeCodeMcp().timeouts(server ?? { transport: 'stdio', config: {} }, serverEnv(server))

/** The connect and `tools/list` budget (`MCP_TIMEOUT`, else 30 s). */
export const resolveConnectTimeoutMs = (server?: Limited): number =>
  serverTimeouts(server).startupMs
