/**
 * Wrap every tool's `execute` with the CC PreToolUse / PostToolUse hooks — the
 * declarative-hook analogue of the plugins' `wrapToolsWithHooks`.
 *
 *   - PreToolUse: `deny`/exit-2 → the tool never runs (a {@link CcHookBlockedError}
 *     is thrown, surfaced to the model as the tool error). `updatedInput` rewrites
 *     the arguments (re-validated against the tool's Zod schema — a failing rewrite
 *     is ignored and logged). `allow`/`ask`/`proceed` fall through to normal
 *     execution (this wrapper runs at execute time, so it cannot bypass the
 *     already-decided permission gate — allow is advisory here).
 *   - PostToolUse: `updatedToolOutput` REPLACES the tool result content
 *     (redaction/summarization); `additionalContext` / a `block` reason is then
 *     appended to it (capped at {@link CC_POST_APPEND_CAP_BYTES}).
 *
 * Returns the SAME array untouched when the runtime is inert (zero overhead).
 */
import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'

import { isBlockedThrow, resultFromThrow } from '../agent-core/tools/tool-error-result'
import { CC_POST_APPEND_CAP_BYTES } from './contracts'
import type { CcHooksRuntime } from './run'
import type { HookLogger } from './executor'

/** Thrown when a CC PreToolUse hook denies a call — surfaces as the tool error. */
export class CcHookBlockedError extends Error {
  constructor(reason: string) {
    super(`Tool call blocked by hook: ${reason}`)
    this.name = 'CcHookBlockedError'
  }
}

/** Re-validate a PreToolUse input rewrite against the tool's Zod schema (if any). */
function reparse(
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

export function wrapToolsWithCcHooks(
  tools: readonly AgentTool[],
  runtime: CcHooksRuntime,
  logger: HookLogger,
): AgentTool[] {
  if (!runtime.active) return [...tools]

  return tools.map((tool) => ({
    ...tool,
    async execute(toolCallId, input, signal, onUpdate, context) {
      let effectiveInput = input

      // ---- PreToolUse -----------------------------------------------------
      const pre = await runtime.runPreToolUse(tool.name, effectiveInput, toolCallId)
      if (pre.decision === 'deny') {
        throw new CcHookBlockedError(pre.reason ?? 'denied')
      }
      if (pre.didRewrite && pre.updatedInput !== undefined) {
        const reparsed = reparse(tool, pre.updatedInput)
        if (reparsed.ok) {
          effectiveInput = reparsed.input
        } else {
          logger.warn(
            `[cc-hooks] PreToolUse updatedInput for "${tool.name}" ignored (schema re-parse failed: ${reparsed.error})`,
          )
        }
      }

      // A THROWN tool error becomes a result here, and PostToolUseFailure runs on it in
      // place of PostToolUse (as in Claude Code) — a hook that logs or explains failures could
      // not observe a failed call at all while the throw flew past to the failure guard (which
      // converts it identically, one wrapper out). Not rethrown afterwards: that would undo the
      // conversion this wrapper just relied on.
      let result: AgentToolResult
      try {
        result = await tool.execute(toolCallId, effectiveInput, signal, onUpdate, context)
      } catch (error) {
        // A pre-hook BLOCK (this wrapper's own deny, or a plugin's from the wrapper
        // inside it) keeps flying: the tool never ran, so there is no output for a
        // post hook to inspect, and the failure guard recognises it by name to stamp
        // `kind:'blocked'`.
        if (isBlockedThrow(error)) throw error
        result = resultFromThrow(tool.name, error)
        const failed = await runtime.runPostToolUseFailure(tool.name, effectiveInput, {
          error: error instanceof Error ? error.message : String(error),
          isInterrupt: Boolean(signal?.aborted),
        })
        if (failed.additionalContext) {
          const note = failed.additionalContext.slice(0, CC_POST_APPEND_CAP_BYTES)
          result = { ...result, content: `${result.content}\n\n[hook] ${note}` }
        }
        return result
      }

      // ---- PostToolUse ----------------------------------------------------
      const post = await runtime.runPostToolUse(tool.name, effectiveInput, result)
      // `updatedToolOutput` REPLACES the model-facing result content (redaction,
      // summarization); `additionalContext` is appended after any replacement.
      if (post.updatedToolOutput !== undefined) {
        result = { ...result, content: post.updatedToolOutput }
      }
      if (post.additionalContext) {
        const note = post.additionalContext.slice(0, CC_POST_APPEND_CAP_BYTES)
        result = { ...result, content: `${result.content}\n\n[hook] ${note}` }
      }
      return result
    },
  }))
}
