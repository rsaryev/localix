import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'

import { reparseToolInput } from '../agent-core/tools/reparse-input'
import { isBlockedThrow, resultFromThrow } from '../agent-core/tools/tool-error-result'
import type { LoadedMiniAppHook } from './loader-contract'
import { isRecord } from '../../lib/record'
import { HOOK_TIMEOUT_MS, invokeHook, type HookRunOptions } from './hook-invoke'

// Tool-call hooks: the pre/post wrapping that lets mini apps audit, block, or
// annotate EVERY tool call (built-in, mini app, MCP alike). Split out of hooks.ts
// so the wrapping logic and its schema-reparse guard stand on their own; the
// historical `./hooks` import surface re-exports these unchanged.

/**
 * MINI APP HOOK EXECUTION — the runtime side of the SDK's `MiniAppHooks`. The loader collects
 * `{ app, hooks, ctx }` from enabled mini apps (`loader-contract.ts`); the chat runtime calls the
 * three clusters: this one wraps EVERY tool's `execute` (built-in, mini app, MCP alike) so
 * `onPreToolCall` can audit, block or rewrite and `onPostToolCall` can annotate;
 * `hooks-messages.ts` rewrites the model-facing prompt and the persisted assistant reply;
 * `hooks-lifecycle.ts` holds the observer-only notifications and `runSessionEndHooks`;
 * `memory-hooks.ts` the memory provider. Every hook runs under the same guarantees: per-mini-app
 * isolation (a throwing hook is logged and NEVER breaks the turn) and a hard timeout per
 * invocation (`HOOK_TIMEOUT_MS`, a timeout reads as a void return).
 */
/** Max bytes of `appendContent` a post hook may add to a tool result. */
export const POST_APPEND_CAP_BYTES = 1024

/** Thrown when a pre hook blocks a call — surfaces to the model as a standard tool error. */
export class ToolCallBlockedError extends Error {
  constructor(app: string, reason: string) {
    super(`Tool call blocked by mini app "${app}": ${reason}`)
    this.name = 'ToolCallBlockedError'
  }
}

/** Entries that actually declare a tool-call hook (cheap pre-filter). */
function toolHookEntries(entries: readonly LoadedMiniAppHook[]): LoadedMiniAppHook[] {
  return entries.filter((e) => e.hooks.onPreToolCall || e.hooks.onPostToolCall)
}

/**
 * Wrap every tool's `execute` with the mini apps' pre/post tool-call hooks.
 * Returns the SAME array when no enabled mini app declares a tool-call hook
 * (zero overhead on the common path). Hook order = mini app load order:
 * pre hooks chain (first `block` wins; `input` rewrites compose, each validated
 * against the tool's schema); post hooks all run, appends accumulate (each
 * capped at POST_APPEND_CAP_BYTES).
 */
export function wrapToolsWithHooks(
  tools: readonly AgentTool[],
  hookEntries: readonly LoadedMiniAppHook[],
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

      // ---- Pre hooks: run in mini app order; first block wins, rewrites compose.
      for (const { app, hooks } of entries) {
        if (!hooks.onPreToolCall) continue
        const outcome = await invokeHook(
          app,
          'onPreToolCall',
          () => hooks.onPreToolCall!({ toolName: tool.name, input: effectiveInput, sessionId }),
          timeoutMs,
          logger,
        )
        if (!isRecord(outcome)) continue
        if ('block' in outcome && typeof outcome.block === 'string') {
          throw new ToolCallBlockedError(app, outcome.block)
        }
        if ('input' in outcome) {
          const reparsed = reparseToolInput(tool, outcome.input)
          if (reparsed.ok) {
            effectiveInput = reparsed.input
          } else {
            logger?.warn(
              `[mini-app:${app}] onPreToolCall input rewrite for "${tool.name}" ignored (schema re-parse failed: ${reparsed.error})`,
            )
          }
        }
      }

      // A THROWN tool error is converted here rather than left to propagate. The
      // failure guard outside this wrapper converts it anyway (for counting), so
      // nothing downstream changes — but a throw that flew past this point took the
      // post hooks with it, and a mini app that redacts or annotates results was blind
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
      for (const { app, hooks } of entries) {
        if (!hooks.onPostToolCall) continue
        const outcome = await invokeHook(
          app,
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
        if (!isRecord(outcome)) continue
        if ('replaceContent' in outcome) {
          if (typeof outcome.replaceContent === 'string' && outcome.replaceContent.trim()) {
            result = { ...result, content: outcome.replaceContent }
          } else {
            logger?.warn(
              `[mini-app:${app}] onPostToolCall replaceContent for "${tool.name}" ignored (must be a non-empty string)`,
            )
          }
        }
        if (typeof outcome.appendContent === 'string' && outcome.appendContent) {
          const note = outcome.appendContent.slice(0, POST_APPEND_CAP_BYTES)
          result = { ...result, content: `${result.content}\n\n[mini-app:${app}] ${note}` }
        }
      }

      return result
    },
  }))
}
