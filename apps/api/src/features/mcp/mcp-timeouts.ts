import { envInt, envString } from '../../lib/env'

import type { McpServerRecord } from './repository'

/**
 * How long an MCP connection and an MCP tool call may take, as Claude Code bounds them (mcp.md,
 * "Time limits on MCP tool calls"; env-vars.md `MCP_TIMEOUT`, `MCP_TOOL_TIMEOUT`,
 * `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`).
 */

/** Connect and `tools/list` budget when `MCP_TIMEOUT` is unset (Claude Code's 30 s). */
export const DEFAULT_TIMEOUT_MS = 30_000

/** A tool call's wall-clock limit when neither `timeout` nor `MCP_TOOL_TIMEOUT` sets one (~28 h). */
export const DEFAULT_TOOL_TIMEOUT_MS = 100_000_000

/** How long a call may hear nothing from its server: 30 min over stdio, 5 min remote. */
const DEFAULT_IDLE_MS = { stdio: 30 * 60_000, remote: 5 * 60_000 }

// CC ignores timeout values below 1s (they fall through to the global default).
const MIN_TIMEOUT_MS = 1_000

/**
 * Parse a positive-integer millisecond timeout from an env var, else undefined.
 * 0 = envInt's "unset or unparseable" sentinel (it only ever yields a positive
 * int); a real timeout has to clear MIN_TIMEOUT_MS anyway.
 */
function envTimeout(name: string): number | undefined {
  const ms = envInt(name, 0)
  return ms >= MIN_TIMEOUT_MS ? ms : undefined
}

/**
 * The capability-discovery (connect / `tools/list`) timeout. Honors the global
 * `MCP_TIMEOUT` env var (CC's server-startup budget), else the built-in default.
 */
export function resolveConnectTimeoutMs(): number {
  return envTimeout('MCP_TIMEOUT') ?? DEFAULT_TIMEOUT_MS
}

/**
 * The per-tool-call timeout for a server. Precedence (CC-compatible):
 *   server `config.timeout` → `MCP_TOOL_TIMEOUT` env → built-in default.
 * Values below 1s are ignored at each level.
 */
export function resolveToolTimeoutMs(config: Record<string, unknown>): number {
  const perServer = typeof config.timeout === 'number' ? config.timeout : undefined
  if (perServer !== undefined && perServer >= MIN_TIMEOUT_MS) return Math.floor(perServer)
  return envTimeout('MCP_TOOL_TIMEOUT') ?? DEFAULT_TOOL_TIMEOUT_MS
}

/**
 * The idle window of a server's tool calls: `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` (0 turns the check
 * off), else 30 minutes for stdio and 5 for a remote server. A per-server `timeout` of at least 1 s
 * is its floor, so a server allowed ten minutes is never cut for idling sooner.
 */
export function resolveToolIdleTimeoutMs(server: Pick<McpServerRecord, 'transport' | 'config'>) {
  const raw = envString('CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT')
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  const configured = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined
  if (configured === 0) return 0
  const idle =
    configured ?? (server.transport === 'stdio' ? DEFAULT_IDLE_MS.stdio : DEFAULT_IDLE_MS.remote)
  const perServer = server.config.timeout
  return typeof perServer === 'number' && perServer >= MIN_TIMEOUT_MS
    ? Math.max(idle, Math.floor(perServer))
    : idle
}
