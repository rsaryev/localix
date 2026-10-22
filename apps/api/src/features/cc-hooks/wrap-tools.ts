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
import type { AgentTool, AgentToolExecutionContext, AgentToolResult } from '@localixai/agent/agents'

import { isBlockedThrow, resultFromThrow } from '../agent-core/tools/tool-error-result'
import { CC_POST_APPEND_CAP_BYTES } from './contracts'
import type { CcHooksRuntime } from './run'
import type { HookLogger } from './executor'
import { blockTaskCompletion, reviewTaskCreation, taskBoardEvent } from './task-events'
import type { McpElicitationHookCarrier } from '../agent-core/tools/hitl/mcp-elicitation'

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

/**
 * Hand the run's Elicitation / ElicitationResult hooks to the call: an MCP server may ask the
 * person for input while its tool runs, and these hooks answer before, or review after, the card.
 */
function withElicitationHooks(
  runtime: CcHooksRuntime,
  context: AgentToolExecutionContext | undefined,
): (AgentToolExecutionContext & McpElicitationHookCarrier) | undefined {
  if (!runtime.hasHooks('Elicitation') && !runtime.hasHooks('ElicitationResult')) return context
  return {
    ...context,
    mcpElicitationHooks: {
      before: (request) => runtime.runElicitation(request),
      after: (request, answer) => runtime.runElicitationResult(request, answer),
    },
  }
}

export function wrapToolsWithCcHooks(
  tools: readonly AgentTool[],
  runtime: CcHooksRuntime,
  logger: HookLogger,
): AgentTool[] {
  if (!runtime.active) return [...tools]

  return tools.map((tool) => ({
    ...tool,
    async execute(toolCallId, input, signal, onUpdate, callContext) {
      let effectiveInput = input
      const context = withElicitationHooks(runtime, callContext)

      // ---- PermissionRequest `updatedInput` ----------------------------------
      // The approval hook rewrote the call it allowed; re-validated like a PreToolUse rewrite.
      const approved = runtime.takeApprovedInput(toolCallId)
      if (approved) {
        const reparsed = reparse(tool, approved.input)
        if (reparsed.ok) effectiveInput = reparsed.input
        else
          logger.warn(
            `[cc-hooks] PermissionRequest updatedInput for "${tool.name}" ignored (schema re-parse failed: ${reparsed.error})`,
          )
      }

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

      // ---- TaskCompleted: before the task board closes a card ---------------
      const taskEvent = taskBoardEvent(runtime, tool.name, effectiveInput)
      const call = [toolCallId, effectiveInput, signal, onUpdate, context] as const
      if (taskEvent === 'TaskCompleted') {
        const refused = await blockTaskCompletion(runtime, tool, call)
        if (refused) throw new CcHookBlockedError(refused)
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

      // ---- TaskCreated: the new cards exist; a blocked one is taken off again
      if (taskEvent === 'TaskCreated' && !result.isError) {
        const reviewed = await reviewTaskCreation(runtime, tool, call, result)
        if (reviewed.blocked) throw new CcHookBlockedError(reviewed.blocked)
        result = reviewed.result
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
