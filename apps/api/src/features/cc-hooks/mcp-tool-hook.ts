/**
 * MCP-tool hook executor (`type:"mcp_tool"`) — call a CONNECTED MCP tool with the hook's
 * `input` and fold its result text like a command hook's stdout.
 *
 * Protocol (CC §MCP tool hooks):
 *   - The tool is called with the hook's `input` as its arguments, `${path}` read from the hook
 *     input JSON (`mcp-tool-input.ts`); a hook without `input` sends none.
 *   - Result text → parsed with the shared command-hook output schema (JSON →
 *     decision, else plain text = context on the context-adding events).
 *   - Server not connected / `isError: true` / any throw → NON-BLOCKING error (`{}`).
 *
 * The actual MCP call is INJECTED via {@link CcMcpToolCaller} (the chat runtime
 * wiring builds it from the process-lifetime `mcpClientManager`), so cc-hooks
 * never imports the MCP feature. Absent caller ⇒ fail-open (`{}`).
 *
 * Layer: api feature module. Pure fold + normalize — no chat/UI/MCP imports.
 */
import type { CcHookHandler, CcHookInput, CcHookOutcome } from './contracts'
import type { HookLogger } from './executor'
import { mcpToolArguments } from './mcp-tool-input'
import { foldHookOutput, worktreePathFromText } from './output-parse'

/** The result of one injected MCP tool call. */
export type CcMcpToolResult = { text: string; isError?: boolean } | { notConnected: true }

/**
 * Injected capability: call the MCP tool named `name` (full name — CC
 * `mcp__server__tool` or Localix `mcp_server_tool`) with `input` as its arguments.
 * MUST resolve (never throw) — a missing/failed server returns `{ notConnected }`.
 */
export type CcMcpToolCaller = (
  name: string,
  input: unknown,
  signal?: AbortSignal,
) => Promise<CcMcpToolResult>

/**
 * Run one mcp_tool hook. `allowPlainTextContext` follows the event (true for the
 * context-adding events). Fail-open on every failure path.
 */
export async function runMcpToolHook(
  handler: CcHookHandler,
  input: CcHookInput,
  callMcpTool: CcMcpToolCaller | undefined,
  allowPlainTextContext: boolean,
  logger: HookLogger,
  signal?: AbortSignal,
): Promise<CcHookOutcome> {
  const label = handler.pluginName ? `plugin:${handler.pluginName}` : handler.source
  if (!callMcpTool || !handler.mcpTool) return {}
  let result: CcMcpToolResult
  try {
    result = await callMcpTool(handler.mcpTool, mcpToolArguments(handler.mcpInput, input), signal)
  } catch (err) {
    logger.warn(
      `[cc-hook:${label}] ${input.hook_event_name} mcp_tool "${handler.mcpTool}" threw: ${String(err)} — non-blocking`,
    )
    return { failed: 'error' }
  }
  if ('notConnected' in result) {
    logger.warn(
      `[cc-hook:${label}] ${input.hook_event_name} mcp_tool "${handler.mcpTool}" not connected — non-blocking`,
    )
    return { failed: 'error' }
  }
  if (result.isError) {
    logger.warn(
      `[cc-hook:${label}] ${input.hook_event_name} mcp_tool "${handler.mcpTool}" returned isError — non-blocking`,
    )
    return { failed: 'error' }
  }
  // The tool's text is read like a command hook's stdout: on WorktreeCreate, a path.
  if (input.hook_event_name === 'WorktreeCreate') return worktreePathFromText(result.text)
  return foldHookOutput(result.text, allowPlainTextContext)
}
