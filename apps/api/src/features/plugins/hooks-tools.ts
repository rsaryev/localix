import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'

import { isBlockedThrow, resultFromThrow } from '../agent-core/tools/tool-error-result'
import type { LoadedPluginHook } from './loader'
import { isPlainObject } from './mcp'
import { HOOK_TIMEOUT_MS, invokeHook, type HookRunOptions } from './hook-invoke'

// Tool-call hooks: the pre/post wrapping that lets plugins audit, block, or
// annotate EVERY tool call (built-in, plugin, MCP alike). Split out of hooks.ts
// so the wrapping logic and its schema-reparse guard stand on their own; the
// historical `./hooks` import surface re-exports these unchanged.

/** Max bytes of `appendContent` a post hook may add to a tool result. */
export const POST_APPEND_CAP_BYTES = 1024

/** Thrown when a pre hook blocks a call — surfaces to the model as a standard tool error. */
export class ToolCallBlockedError extends Error {
  constructor(pluginName: string, reason: string) {
    super(`Tool call blocked by plugin "${pluginName}": ${reason}`)
    this.name = 'ToolCallBlockedError'
  }
}

/**
 * Validate a pre-hook input rewrite against the tool's schema. Zod schemas
 * (anything with `safeParse`) are re-parsed — a failing rewrite is rejected.
 * Non-zod schemas (e.g. MCP JSON schemas) can't be re-parsed host-side; the
 * rewrite is accepted as-is and the downstream tool owns validation.
 */
function reparseRewrite(
  tool: AgentTool,
  rewrite: unknown,
): { ok: true; input: unknown } | { ok: false; error: string } {
  const schema = tool.inputSchema as
    | {
        safeParse?: (v: unknown) => {
          success: boolean
          data?: unknown
          error?: { message?: string }
        }
      }
    | undefined
  if (!schema || typeof schema.safeParse !== 'function') return { ok: true, input: rewrite }
  const parsed = schema.safeParse(rewrite)
  if (parsed.success) return { ok: true, input: parsed.data }
  return { ok: false, error: parsed.error?.message ?? 'schema re-parse failed' }
}

/** Entries that actually declare a tool-call hook (cheap pre-filter). */
function toolHookEntries(entries: readonly LoadedPluginHook[]): LoadedPluginHook[] {
  return entries.filter((e) => e.hooks.onPreToolCall || e.hooks.onPostToolCall)
}

/**
 * Wrap every tool's `execute` with the plugins' pre/post tool-call hooks.
 * Returns the SAME array when no enabled plugin declares a tool-call hook
 * (zero overhead on the common path). Hook order = plugin load order:
 * pre hooks chain (first `block` wins; `input` rewrites compose, each validated
 * against the tool's schema); post hooks all run, appends accumulate (each
 * capped at POST_APPEND_CAP_BYTES).
 */
export function wrapToolsWithHooks(
  tools: readonly AgentTool[],
  hookEntries: readonly LoadedPluginHook[],
  options: HookRunOptions,
): AgentTool[] {
  const entries = toolHookEntries(hookEntries)
  if (entries.length === 0) return [...tools]
  const timeoutMs = options.timeoutMs ?? HOOK_TIMEOUT_MS
  const { sessionId, logger } = options

  return tools.map((tool) => ({
    ...tool,
    async execute(toolCallId, input, signal, onUpdate, context) {
      let effectiveInput = input

      // ---- Pre hooks: run in plugin order; first block wins, rewrites compose.
      for (const { pluginName, hooks } of entries) {
        if (!hooks.onPreToolCall) continue
        const outcome = await invokeHook(
          pluginName,
          'onPreToolCall',
          () => hooks.onPreToolCall!({ toolName: tool.name, input: effectiveInput, sessionId }),
          timeoutMs,
          logger,
        )
        if (!isPlainObject(outcome)) continue
        if ('block' in outcome && typeof outcome.block === 'string') {
          throw new ToolCallBlockedError(pluginName, outcome.block)
        }
        if ('input' in outcome) {
          const reparsed = reparseRewrite(tool, outcome.input)
          if (reparsed.ok) {
            effectiveInput = reparsed.input
          } else {
            logger?.warn(
              `[plugin:${pluginName}] onPreToolCall input rewrite for "${tool.name}" ignored (schema re-parse failed: ${reparsed.error})`,
            )
          }
        }
      }

      // A THROWN tool error is converted here rather than left to propagate. The
      // failure guard outside this wrapper converts it anyway (for counting), so
      // nothing downstream changes — but a throw that flew past this point took the
      // post hooks with it, and a plugin that redacts or annotates results was blind
      // to exactly the calls that failed. Convert, run the post hooks against the
      // error result, return it: rethrowing afterwards would undo the conversion.
      let result: AgentToolResult
      try {
        result = await tool.execute(toolCallId, effectiveInput, signal, onUpdate, context)
      } catch (error) {
        // A block is not an execution failure: it is raised by a pre hook, the tool
        // never ran, and the failure guard reads it by name to stamp `kind:'blocked'`.
        if (isBlockedThrow(error)) throw error
        result = resultFromThrow(tool.name, error)
      }

      // ---- Post hooks: ALL run (observe), appends accumulate. They see a FAILED
      // call too — `result.isError` tells them which one they are looking at.
      for (const { pluginName, hooks } of entries) {
        if (!hooks.onPostToolCall) continue
        const outcome = await invokeHook(
          pluginName,
          'onPostToolCall',
          () =>
            hooks.onPostToolCall!({
              toolName: tool.name,
              input: effectiveInput,
              result,
              sessionId,
            }),
          timeoutMs,
          logger,
        )
        if (!isPlainObject(outcome)) continue
        if ('replaceContent' in outcome) {
          if (typeof outcome.replaceContent === 'string' && outcome.replaceContent.trim()) {
            result = { ...result, content: outcome.replaceContent }
          } else {
            logger?.warn(
              `[plugin:${pluginName}] onPostToolCall replaceContent for "${tool.name}" ignored (must be a non-empty string)`,
            )
          }
        }
        if (typeof outcome.appendContent === 'string' && outcome.appendContent) {
          const note = outcome.appendContent.slice(0, POST_APPEND_CAP_BYTES)
          result = { ...result, content: `${result.content}\n\n[plugin:${pluginName}] ${note}` }
        }
      }

      return result
    },
  }))
}
