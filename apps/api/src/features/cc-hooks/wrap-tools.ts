/**
 * Wrap every tool's `execute` with the CC PreToolUse / PostToolUse hooks — the
 * declarative-hook analogue of the plugins' `wrapToolsWithHooks`.
 *
 *   - PreToolUse: `deny`/exit-2 → the tool never runs (a {@link CcHookBlockedError}
 *     is thrown, surfaced to the model as the tool error); `continue:false` refuses it
 *     too and ends the run after the batch. `updatedInput` rewrites the arguments
 *     (re-validated against the tool's Zod schema — a failing rewrite is ignored and
 *     logged). `allow`/`ask` ride on the call's context to the permission gate, which
 *     runs inside this wrapper whenever PreToolUse hooks exist (`chain-gate.ts`).
 *   - PostToolUse: `updatedToolOutput` REPLACES the tool result content
 *     (redaction/summarization); PostToolUseFailure runs instead for a call that failed.
 *   - Every tool event's `additionalContext` (and a PostToolUse `block` reason) follows
 *     the result in a system reminder (`tool-hook-results.ts`).
 *
 * Returns the SAME array untouched when the runtime is inert (zero overhead).
 */
import type { AgentTool, AgentToolExecutionContext, AgentToolResult } from '@localixai/agent/agents'

import type { PreToolUseVerdictCarrier } from '../agent-core/permission-hook-decision'
import { reparseToolInput } from '../agent-core/tools/reparse-input'
import { isBlockedThrow, resultFromThrow } from '../agent-core/tools/tool-error-result'
import { joinContext } from './runtime-results'
import { failureText, withContextReminder } from './tool-hook-results'
import type { CcHooksRuntime } from './run'
import type { HookLogger } from './executor'
import { blockTaskCompletion, reviewTaskCreation, taskBoardEvent } from './task-events'
import type { McpElicitationHookCarrier } from '../agent-core/tools/hitl/mcp-elicitation'

/**
 * AskUserQuestion's `answers` are a hook's, not the model's, so the ask tool's schema leaves them
 * out and its re-parse drops them; they are carried onto the re-parsed call here.
 */
function withHookAnswers(toolName: string, input: unknown, updated: unknown): unknown {
  const answers = (updated as { answers?: unknown } | null)?.answers
  if (toolName !== 'ask' || !answers || typeof answers !== 'object') return input
  return { ...(input as Record<string, unknown>), answers }
}

/** Thrown when a CC PreToolUse hook denies a call — surfaces as the tool error. */
export class CcHookBlockedError extends Error {
  constructor(reason: string) {
    super(`Tool call blocked by hook: ${reason}`)
    this.name = 'CcHookBlockedError'
  }
}

/**
 * The call as a PermissionRequest hook's `updatedInput` rewrote it when it allowed the call,
 * taken once and re-validated like a PreToolUse rewrite; undefined when no hook rewrote it. Read
 * where the gate has decided: here when the loop's gate ran before the call, and after the gate
 * when the gate runs inside the tool-call chain (`chat/runtime/run/chain-gate.ts`).
 */
export function approvedInputFor(
  runtime: CcHooksRuntime,
  tool: AgentTool,
  toolCallId: string,
  logger: HookLogger,
): { input: unknown } | undefined {
  if (!runtime.active) return undefined
  const approved = runtime.takeApprovedInput(toolCallId)
  if (!approved) return undefined
  const reparsed = reparseToolInput(tool, approved.input)
  if (reparsed.ok) return { input: reparsed.input }
  logger.warn(
    `[cc-hooks] PermissionRequest updatedInput for "${tool.name}" ignored (schema re-parse failed: ${reparsed.error})`,
  )
  return undefined
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
      const approved = approvedInputFor(runtime, tool, toolCallId, logger)
      if (approved) effectiveInput = approved.input

      // ---- PreToolUse -----------------------------------------------------
      const pre = await runtime.runPreToolUse(tool, effectiveInput, toolCallId)
      // `continue:false`: the call is refused and the run ends after this batch (`terminate`).
      // Returned rather than thrown, so the outer wrappers hand the flag on to the loop.
      if (pre.stop) {
        const refusal = new CcHookBlockedError(pre.stop.reason)
        const stopped = resultFromThrow(tool.name, refusal)
        return {
          ...stopped,
          content: withContextReminder(stopped.content, pre.additionalContext),
          terminate: true,
        }
      }
      if (pre.decision === 'deny') {
        throw new CcHookBlockedError(
          withContextReminder(pre.reason ?? 'denied', pre.additionalContext),
        )
      }
      // An `allow` that came with a rewrite approved the rewritten call: when the rewrite is
      // discarded, the original call goes to the gate without it.
      let decision = pre.decision
      if (pre.didRewrite && pre.updatedInput !== undefined) {
        const reparsed = reparseToolInput(tool, pre.updatedInput)
        if (reparsed.ok) {
          effectiveInput = withHookAnswers(tool.name, reparsed.input, pre.updatedInput)
        } else {
          if (decision === 'allow') decision = 'proceed'
          logger.warn(
            `[cc-hooks] PreToolUse updatedInput for "${tool.name}" ignored (schema re-parse failed: ${reparsed.error})`,
          )
        }
      }

      // allow/ask reach the permission gate inside the chain on the call's context.
      const verdict =
        decision === 'allow' || decision === 'ask'
          ? { decision, ...(pre.reason ? { reason: pre.reason } : {}) }
          : undefined
      const gated: (typeof context & PreToolUseVerdictCarrier) | undefined = verdict
        ? { ...context, preToolUseVerdict: verdict }
        : context

      // ---- TaskCompleted: before the task board closes a card ---------------
      const taskEvent = taskBoardEvent(runtime, tool.name, effectiveInput)
      const call = [toolCallId, effectiveInput, signal, onUpdate, gated] as const
      if (taskEvent === 'TaskCompleted') {
        const refused = await blockTaskCompletion(runtime, tool, call)
        if (refused) throw new CcHookBlockedError(refused)
      }

      // A THROWN tool error becomes a result here, and PostToolUseFailure runs on it in
      // place of PostToolUse (as in Claude Code) — a hook that logs or explains failures could
      // not observe a failed call at all while the throw flew past to the failure guard (which
      // converts it identically, one wrapper out). Not rethrown afterwards: that would undo the
      // conversion this wrapper just relied on.
      // A RETURNED error (a command that ran and exited non-zero) is a failure too: Claude Code
      // runs PostToolUseFailure, not PostToolUse, for "a tool that started executing" and failed.
      let result: AgentToolResult
      let failure: string | undefined
      const started = performance.now()
      const elapsed = () => Math.round(performance.now() - started)
      try {
        result = await tool.execute(...call)
        if (result.isError && result.error?.kind !== 'blocked') failure = failureText(result)
      } catch (error) {
        // A pre-hook BLOCK (this wrapper's own deny, or a plugin's from the wrapper
        // inside it) keeps flying: the tool never ran, so there is no output for a
        // post hook to inspect, and the failure guard recognises it by name to stamp
        // `kind:'blocked'`.
        if (isBlockedThrow(error)) throw error
        result = resultFromThrow(tool.name, error)
        failure = error instanceof Error ? error.message : String(error)
      }
      if (failure !== undefined) {
        const failed = await runtime.runPostToolUseFailure(
          tool,
          effectiveInput,
          { error: failure, isInterrupt: Boolean(signal?.aborted), durationMs: elapsed() },
          toolCallId,
        )
        const context = joinContext([pre.additionalContext, failed.additionalContext])
        return { ...result, content: withContextReminder(result.content, context) }
      }

      // ---- TaskCreated: the new cards exist; a blocked one is taken off again
      if (taskEvent === 'TaskCreated' && !result.isError) {
        const reviewed = await reviewTaskCreation(runtime, tool, call, result)
        if (reviewed.blocked) throw new CcHookBlockedError(reviewed.blocked)
        result = reviewed.result
      }

      // ---- PostToolUse ----------------------------------------------------
      const ran = elapsed()
      const post = await runtime.runPostToolUse(tool, effectiveInput, result, toolCallId, ran)
      // `updatedToolOutput` REPLACES the model-facing result content (redaction,
      // summarization); `additionalContext` is appended after any replacement.
      if (post.updatedToolOutput !== undefined) {
        result = { ...result, content: post.updatedToolOutput }
      }
      const note = joinContext([pre.additionalContext, post.additionalContext])
      return { ...result, content: withContextReminder(result.content, note) }
    },
  }))
}
