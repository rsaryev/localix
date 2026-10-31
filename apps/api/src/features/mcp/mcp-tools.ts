import { errorMessage } from '../../lib/errors'

import { type AgentTool, type CallClass, mcpInputSchema } from '@localixai/agent/agents'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'

import type { McpClientLike, McpToolDef, McpToolAnnotations } from './mcp-client-contracts'

import type { McpServerRecord } from './repository'
import { createCallDeadline, withElicitationRoute } from './mcp-elicitation'
import {
  capMcpErrorMessage,
  type McpContentPart,
  mapCallResult,
  resolveMcpResultMaxChars,
} from './mcp-result'

import { resolveToolIdleTimeoutMs, resolveToolTimeoutMs, serverEnv } from './mcp-timeouts'

/** MCP tool descriptions can be huge (multi-KB); cap what reaches the model. */
export const MCP_DESCRIPTION_MAX_CHARS = 600

function capDescription(description: string): string {
  return description.length > MCP_DESCRIPTION_MAX_CHARS
    ? `${description.slice(0, MCP_DESCRIPTION_MAX_CHARS - 1)}…`
    : description
}

/**
 * Apply the SERVER's model-visibility metadata, then the caller's policy.
 *
 * An explicit `ui.visibility` array must include `model`; absent or malformed metadata
 * remains visible. That half is the server's own statement about its tools and belongs here.
 *
 * The other half — which tools this installation permits — used to be `enabledTools` /
 * `disabledTools` on the server's stored config, and that was the last capability in the
 * product decided by something other than a rule. It had no scope (a role could not narrow a
 * server to two of its tools), and editing it rewrote the config, which is part of the client
 * cache key, so switching one tool off reconnected the server and blanked its inventory.
 * Callers now pass the predicate and the rules answer it.
 */
export function filterToolDefs<T extends { name: string; _meta?: Record<string, unknown> }>(
  defs: T[],
  isVisible?: (toolName: string) => boolean,
): T[] {
  const out = modelVisibleToolDefs(defs)
  return isVisible ? out.filter((def) => isVisible(def.name)) : out
}

/** Tools the server exposes to models before the user's per-server allow/deny filters. */
export function modelVisibleToolDefs<T extends { name: string; _meta?: Record<string, unknown> }>(
  defs: T[],
): T[] {
  return defs.filter(isMcpToolModelVisible)
}

function isMcpToolModelVisible(tool: { _meta?: Record<string, unknown> }): boolean {
  const ui = tool._meta?.ui
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) return true
  const visibility = (ui as Record<string, unknown>).visibility
  if (!Array.isArray(visibility)) return true
  return visibility.some((target) => target === 'model')
}

/**
 * The model-facing name for one server's tool. Exported because a SECOND caller needs it: the
 * capability snapshot estimates the MCP half of the tool count from the connection cache, and an
 * estimate that reimplemented this sanitisation would drift from what `gather` actually sends —
 * which is the exact failure ("says 128 but the picker shows 118") this whole count exists to
 * avoid. One rule, two readers.
 */
export function namespacedName(server: string, tool: string): string {
  // Keep within a safe tool-name charset and reasonably short.
  const clean = `mcp_${server}_${tool}`.replace(/[^a-zA-Z0-9_]/g, '_')
  return clean.length > 64 ? clean.slice(0, 64) : clean
}

/**
 * Two distinct (server, tool) pairs can sanitize/truncate to the SAME namespaced
 * name (e.g. servers `git-hub` and `git_hub` both → `mcp_git_hub_*`, or two long
 * names truncated to the same 64 chars). Un-disambiguated, the later tool silently
 * shadows the earlier in the agent's last-writer-wins tool map. Append a numeric
 * suffix (kept ≤ 64) so every gathered tool name is unique.
 */
export function disambiguate(name: string, used: Set<string>): string {
  if (!used.has(name)) return name
  for (let n = 2; ; n++) {
    const suffix = `_${n}`
    const base = name.length + suffix.length > 64 ? name.slice(0, 64 - suffix.length) : name
    const candidate = base + suffix
    if (!used.has(candidate)) return candidate
  }
}

/** Socket-level errno codes that mean the transport itself is gone. */
const TRANSPORT_ERRNO = new Set(['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ENOTCONN'])

/**
 * Errors that mean "the connection is gone", as opposed to a tool-level failure. Judged by
 * structure — the SDK's `ConnectionClosed` code or a socket errno anywhere in the cause chain —
 * so a tool whose own failure text mentions "connection refused" (a database tool, say) does not
 * tear down a healthy client. The SDK's one untyped signal is its bare `Error('Not connected')`.
 */
export function isTransportError(err: unknown): boolean {
  if (err instanceof McpError) return err.code === ErrorCode.ConnectionClosed
  let current: unknown = err
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && TRANSPORT_ERRNO.has(code)) return true
    current = (current as { cause?: unknown }).cause
  }
  return err instanceof Error && err.message === 'Not connected'
}

/**
 * Read the CC `anthropic/maxResultSizeChars` annotation from a raw MCP tool def.
 * The key may sit on the tool's `annotations` object or at the top level; accept
 * either. Returns undefined when absent or non-positive.
 */
export function readMaxResultChars(rawDef: unknown): number | undefined {
  if (!rawDef || typeof rawDef !== 'object') return undefined
  const def = rawDef as Record<string, unknown>
  const annotations =
    def.annotations && typeof def.annotations === 'object'
      ? (def.annotations as Record<string, unknown>)
      : undefined
  const candidate =
    def['anthropic/maxResultSizeChars'] ?? annotations?.['anthropic/maxResultSizeChars']
  const n = typeof candidate === 'number' ? candidate : undefined
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

/**
 * What every call of one MCP tool reaches. A remote server's tool can do anything, and its
 * annotations are advisory claims the server makes about itself — so only an explicit
 * `readOnlyHint: true` reads as `read`; an absent hint is `external`. A tool that claims to be
 * read-only AND destructive contradicts itself and is believed on the dangerous half. The
 * arguments are opaque to the host, so the class is per tool, not per call.
 */
export function classifyMcpTool(annotations: McpToolAnnotations | undefined): CallClass {
  const destructive = annotations?.destructiveHint === true
  if (annotations?.readOnlyHint === true && !destructive) return { effect: 'read' }
  return destructive ? { effect: 'external', irreversible: true } : { effect: 'external' }
}

/** A server as Claude Code names it in a tool's address; plugin records are `plugin:<p>:<s>`. */
function claudeCodeServerName(server: McpServerRecord): string {
  const plugin = /^plugin:([^:]+):(.+)$/.exec(server.id)
  return plugin ? `plugin_${plugin[1]}_${plugin[2]}` : server.name
}

/**
 * Claude Code's callable name for one server's tool, `mcp__<server>__<tool>`: "any character
 * outside `A-Z`, `a-z`, `0-9`, `_`, and `-` is replaced with `_`" (Claude Code's MCP reference).
 */
export function claudeCodeMcpToolName(server: McpServerRecord, tool: string): string {
  return `mcp__${claudeCodeServerName(server)}__${tool}`.replace(/[^A-Za-z0-9_-]/g, '_')
}

/**
 * A plugin server's tool reaches the model under Claude Code's name, the one its skills use, where
 * every provider accepts it (≤ 64 characters); `mcp_<server>_<tool>` stays the tool's identity.
 */
export function pluginToolModelName(server: McpServerRecord, tool: string): string | undefined {
  if (!server.id.startsWith('plugin:')) return undefined
  const name = claudeCodeMcpToolName(server, tool)
  return /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name) ? name : undefined
}

/**
 * Where a server's definition came from, as a Claude Code hook's `mcp_server` reports it: a
 * plugin's server under its scoped `plugin:<plugin>:<server>` name, a server the person added
 * under its own name, `user` when it serves every chat and `local` when it serves one project.
 */
export function mcpServerProvenance(server: McpServerRecord): { name: string; source: string } {
  if (server.id.startsWith('plugin:')) return { name: server.id, source: 'plugin' }
  return { name: server.name, source: server.projectId ? 'local' : 'user' }
}

export function buildToolForServer(
  server: McpServerRecord,
  client: McpClientLike,
  def: McpToolDef,
  onTransportError?: () => void,
): AgentTool {
  const toolName = namespacedName(server.name, def.name)
  const description = def.description?.trim()
    ? `[MCP: ${server.name}] ${capDescription(def.description.trim())}`
    : `[MCP: ${server.name}] ${def.name}`
  const env = serverEnv(server)
  const timeout = resolveToolTimeoutMs(server.config, env)
  const idleTimeout = resolveToolIdleTimeoutMs(server)
  const maxResultChars = resolveMcpResultMaxChars(def.maxResultChars, env)
  const callClass = classifyMcpTool(def.annotations)
  const mutates = callClass.effect !== 'read'
  const modelName = pluginToolModelName(server, def.name)

  return {
    name: toolName,
    ...(modelName ? { modelName } : {}),
    description,
    label: `${server.name} · ${def.name}`,
    // Claude Code's address for it: a plugin's server as `plugin_<plugin>_<server>`.
    aliases: [claudeCodeMcpToolName(server, def.name)],
    mcpServer: mcpServerProvenance(server),
    inputSchema: mcpInputSchema(def.inputSchema),
    activeVerb: 'Running',
    mutates,
    classify: () => callClass,
    ...(def.annotations ? { behaviorHints: def.annotations } : {}),
    async execute(toolCallId, input, signal, _onUpdate, context) {
      // The call's timeout stops while its server waits on the person (elicitation).
      const deadline = createCallDeadline(
        timeout,
        signal,
        (kind) =>
          kind === 'idle'
            ? McpError.fromError(
                ErrorCode.RequestTimeout,
                `Request timed out: no response or progress for ${idleTimeout} ms`,
                { timeout: idleTimeout },
              )
            : McpError.fromError(ErrorCode.RequestTimeout, 'Request timed out', { timeout }),
        idleTimeout,
      )
      try {
        const call = {
          server: server.id.startsWith('plugin:') ? server.id : server.name,
          displayName: server.name,
          toolCallId,
          context,
          signal,
          hold: () => deadline.hold(),
        }
        const result = await withElicitationRoute(client, call, () =>
          client.callTool(
            { name: def.name, arguments: (input ?? {}) as Record<string, unknown> },
            undefined,
            {
              timeout: deadline.sdkTimeoutMs,
              resetTimeoutOnProgress: true,
              onprogress: deadline.progress,
              signal: deadline.signal,
            },
          ),
        )
        const content = (result.content ?? []) as McpContentPart[]
        return mapCallResult(content, result.isError === true, maxResultChars, {
          provider: `MCP · ${server.name}`,
        })
      } catch (err) {
        const rawMessage = errorMessage(err)
        // A dead transport means the cached client must be reconnected next turn.
        if (isTransportError(err)) onTransportError?.()
        const message = capMcpErrorMessage(rawMessage, maxResultChars)
        return {
          content: `MCP tool "${def.name}" failed: ${message}`,
          isError: true,
          error: {
            kind: 'execution',
            message,
            userMessage: `MCP server "${server.name}" failed: ${message}`,
            retryable: true,
            fatal: false,
          },
        }
      } finally {
        deadline.clear()
      }
    },
  }
}
