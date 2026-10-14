import type { AgentTool } from '@localixai/agent/agents'
import type { CcMcpToolResult } from '../../../cc-hooks'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { SessionRecord } from '../../repository'
import type { RunEnv } from './types'
import type { AvailabilityReader } from '../../../capabilities/availability'
import {
  NO_ROSTERS,
  projectCapabilities,
  type ResolvedCapabilities,
} from '../../../capabilities/resolve'
import { createPermissionGate } from '../../../agent-core/permission-gate'
import { resolveRunProfile } from '../../../agent-core/run-shape'
import { externalToolSurface } from './external-tool-surface'
import { resolveMcpTools } from './mcp-tools'
import { prefixedWarnLogger } from '../plugin-hook-logger'
const hookWarn = prefixedWarnLogger('cc-hook')

/** CC-hook name form (`mcp__server__tool`) → the engine's (`mcp_server_tool`). */
function normalizeMcpName(name: string): string {
  return name.replace(/^mcp__/, 'mcp_').replace(/__/g, '_')
}

/**
 * `mcp_tool` hooks. Call a CONNECTED MCP tool by full name (CC `mcp__server__tool`
 * or Localix `mcp_server_tool`) with the hook input as arguments. Built from the
 * same MCP resolution the run itself uses (process-lifetime client manager →
 * cached clients); the gather is MEMOIZED per run, so a per-tool-call hook does
 * not re-list servers on every fire.
 */
export function createMcpHookCaller(input: {
  env: RunEnv
  userId: string
  session: SessionRecord
  agentId?: string
  loadedPlugins: LoadedPlugins
  defaultCwd: string
  disabledTools: string[]
  /** What the run's rules say about its MCP servers. */
  availability: AvailabilityReader
  capabilities: ResolvedCapabilities
}): (name: string, toolInput: unknown, signal?: AbortSignal) => Promise<CcMcpToolResult> {
  const { env, userId, session, loadedPlugins, defaultCwd, disabledTools, availability } = input
  let toolsPromise: Promise<AgentTool[]> | null = null

  return async (name, toolInput, signal) => {
    if (!toolsPromise) {
      toolsPromise = resolveMcpTools({
        env,
        userId,
        session,
        pluginMcpServers: loadedPlugins.mcpServers,
        defaultCwd,
        availability,
      })
        .then(
          (r) =>
            externalToolSurface({
              tools: r.gather?.tools ?? [],
              profile: resolveRunProfile({ sessionKind: session.sessionKind }),
              capabilities: input.capabilities,
              disabledTools,
            }).tools,
        )
        .catch((err: unknown) => {
          hookWarn.warn(`mcp_tool hook could not resolve MCP tools: ${String(err)}`)
          return []
        })
    }
    const tools = await toolsPromise
    const target = normalizeMcpName(name)
    const tool = tools.find(
      (t) => t.name === name || t.name === target || normalizeMcpName(t.name) === target,
    )
    if (!tool) return { notConnected: true }
    // Hooks execute without a person waiting for a card. A denied or confirmation-requiring
    // action must not run through this alternate entry point; its verdict can still fail open.
    const gate = createPermissionGate({
      rules: projectCapabilities(input.capabilities, NO_ROSTERS).permissions,
      toolsByName: new Map([[tool.name, tool]]),
      root: defaultCwd,
    })
    const decision = await gate({
      toolCallId: 'cc-hook-mcp',
      toolName: tool.name,
      input: toolInput,
    })
    if (decision?.block)
      return {
        text: decision.blockedMessage ?? 'Hook tool call is unavailable under the agent policy.',
        isError: true,
      }
    try {
      const result = await tool.execute('cc-hook-mcp', toolInput, signal)
      const text =
        typeof result.content === 'string' ? result.content : String(result.content ?? '')
      return { text, isError: result.isError === true }
    } catch (err) {
      // The tool IS connected — it ran and threw. Reporting that as `notConnected`
      // sends the operator hunting a server outage; the caller contract is only that
      // this never throws, so hand back the failure as what it is.
      return { text: err instanceof Error ? err.message : String(err), isError: true }
    }
  }
}
