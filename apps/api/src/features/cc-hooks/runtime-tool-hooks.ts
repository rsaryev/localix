/**
 * The tool events of a per-run CC hooks runtime (`run.ts`): PreToolUse, PostToolUse and
 * PostToolUseFailure. PreToolUse and PostToolUse drive `select` + `fireAsync` + `runHandler`
 * by hand, because each handler sees the previous one's rewrite (and a deny cuts PreToolUse short).
 */
import {
  claudeCodeHookCall,
  claudeCodeToolResponse,
  localInputFromHook,
} from '../ext/cc-tool-shapes'
import type { CcHookEvent, CcHookHandler, CcHookInput, CcHookOutcome } from './contracts'
import type { CcHookInputBase } from './protocol-types'
import { matchesToolName } from './matcher'
import type {
  CcHookToolRef,
  CcHooksRuntime,
  CcRunStop,
  PreToolUseResult,
} from './runtime-contracts'
import { joinContext } from './runtime-results'
import { runInParallel } from './runtime-parallel'
import { replacementContent } from './tool-output-replacement'
import type { createHookSelector, SelectOptions } from './runtime-selection'
import type { createHookHandlerRunner } from './runtime-handler'

/** What every event runner of one runtime shares (built once in `run.ts`). */
export interface HookDispatchDeps {
  select: ReturnType<typeof createHookSelector>
  runHandler: ReturnType<typeof createHookHandlerRunner>
  fireAsync: (handlers: CcHookHandler[], input: CcHookInput) => void
  runAll: (
    event: CcHookEvent,
    matchFn: (matcher: string | undefined) => boolean,
    input: CcHookInput,
    addContextOnZero: boolean,
    opts?: SelectOptions,
  ) => Promise<CcHookOutcome[]>
  baseInput: <E extends CcHookEvent>(event: E) => CcHookInputBase & { hook_event_name: E }
  /** Shows the person a hook's line (a `stopReason`); absent → dropped. */
  emitNotice?: (message: string, event: CcHookEvent) => void
  /** Records that a hook ended the run (`CcHooksRuntime.stoppedBy`); the first stop stays. */
  stopRun?: (stop: CcRunStop) => void
}

/** The tool behind a reference: a bare name carries no aliases and no MCP server. */
export const toolRefOf = (tool: CcHookToolRef) => (typeof tool === 'string' ? { name: tool } : tool)

export function createToolHookRunners({
  select,
  runHandler,
  fireAsync,
  runAll,
  baseInput,
  emitNotice,
  stopRun,
}: HookDispatchDeps): Pick<
  CcHooksRuntime,
  'runPreToolUse' | 'runPostToolUse' | 'runPostToolUseFailure'
> {
  return {
    async runPreToolUse(tool: CcHookToolRef, input: unknown, toolUseId?: string) {
      const ref = toolRefOf(tool)
      const toolName = ref.name
      // Each handler sees the previous one's rewrite, and a deny cuts the chain —
      // neither fits `runAll`'s one-input/run-them-all contract.
      // The hook reads the call as Claude Code names and shapes it (`Bash`, `file_path`).
      const base = baseInput('PreToolUse')
      const selected = select(
        'PreToolUse',
        (m) => matchesToolName(m, toolName, ref.aliases, input),
        { ifCtx: { toolName, toolInput: input, aliases: ref.aliases, cwd: base.cwd } },
      )
      if (!selected) return { decision: 'proceed', didRewrite: false }
      const inputFor = (toolInput: unknown): CcHookInput => ({
        ...base,
        ...claudeCodeHookCall(ref, toolInput, base.cwd),
        ...(toolUseId ? { tool_use_id: toolUseId } : {}),
      })
      // async PreToolUse hooks can't block (fire against the pre-rewrite input).
      fireAsync(selected.async, inputFor(input))
      let effectiveInput = input
      let didRewrite = false
      let decision: PreToolUseResult['decision'] = 'proceed'
      let reason: string | undefined
      // "String added to Claude's context alongside the tool result", from every handler.
      const contexts: (string | undefined)[] = []
      const rewritten = () => ({
        didRewrite,
        ...(didRewrite ? { updatedInput: effectiveInput } : {}),
        ...(joinContext(contexts) ? { additionalContext: joinContext(contexts) } : {}),
      })
      // Every handler runs at once on the call as Claude made it; the outcomes fold in
      // declaration order (`runtime-parallel.ts`), so a deny never keeps the others from running.
      const outcomes = await runInParallel(selected.sync, (h) =>
        runHandler('PreToolUse', h, inputFor(input), false),
      )
      for (const o of outcomes) contexts.push(o.additionalContext)
      // `continue:false` "takes precedence over any event-specific decision fields": the call
      // does not run, processing stops, and the stopReason is shown to the person.
      const stopped = outcomes.find((o) => o.continue === false)
      if (stopped) {
        const stopReason = stopped.stopReason?.trim() || 'A PreToolUse hook stopped the run.'
        emitNotice?.(stopReason, 'PreToolUse')
        stopRun?.({ event: 'PreToolUse', reason: stopReason })
        return {
          decision: 'deny',
          reason: stopReason,
          stop: { reason: stopReason },
          ...rewritten(),
        }
      }
      const denied = outcomes.find(
        (o) => o.blocked || o.decision === 'block' || o.permissionDecision === 'deny',
      )
      if (denied) {
        return {
          decision: 'deny',
          reason:
            denied.blockReason ||
            denied.permissionDecisionReason ||
            denied.reason ||
            // hookify's block gives its rule's text only as the `systemMessage`.
            denied.systemMessage?.trim() ||
            'Tool call denied by hook',
          ...rewritten(),
        }
      }
      for (const o of outcomes) {
        // Each hook replaced the whole input it was shown; the last one declared stands.
        if ('updatedInput' in o && o.updatedInput !== undefined) {
          effectiveInput = localInputFromHook(toolName, input, o.updatedInput, base.cwd)
          didRewrite = true
        }
        // "precedence is deny > defer > ask > allow" (deny already returned above).
        if (o.permissionDecision === 'ask' && decision !== 'ask') {
          decision = 'ask'
          reason = o.permissionDecisionReason
        } else if (o.permissionDecision === 'allow' && decision === 'proceed') {
          decision = 'allow'
          reason = o.permissionDecisionReason
        }
      }
      return { decision, ...(reason ? { reason } : {}), ...rewritten() }
    },

    async runPostToolUse(
      tool: CcHookToolRef,
      input: unknown,
      result: { content: string; details?: unknown },
      toolUseId?: string,
      durationMs?: number,
    ) {
      const ref = toolRefOf(tool)
      const toolName = ref.name
      // Each handler observes the previous one's output replacement — same reason as
      // PreToolUse for driving the dispatch by hand.
      const base = baseInput('PostToolUse')
      const selected = select(
        'PostToolUse',
        (m) => matchesToolName(m, toolName, ref.aliases, input),
        { ifCtx: { toolName, toolInput: input, aliases: ref.aliases, cwd: base.cwd } },
      )
      if (!selected) return {}
      // A replaced output reaches the next hook as the whole response (its own details are gone).
      const inputFor = (content: string, replaced: boolean): CcHookInput => ({
        ...base,
        ...claudeCodeHookCall(ref, input, base.cwd),
        tool_response: claudeCodeToolResponse(
          { name: toolName },
          replaced ? { content } : { content, details: result.details },
          input,
          base.cwd,
        ),
        ...(toolUseId ? { tool_use_id: toolUseId } : {}),
        ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
      })
      fireAsync(selected.async, inputFor(result.content, false))
      const contexts: (string | undefined)[] = []
      // Every handler sees the tool's own output; the last replacement declared stands.
      let replaced: string | undefined
      const outcomes = await runInParallel(selected.sync, (h) =>
        runHandler('PostToolUse', h, inputFor(result.content, false), false),
      )
      for (const o of outcomes) {
        // PostToolUse cannot block (tool already ran): a `decision:block` reason and an exit-2
        // stderr ("Shows stderr to Claude") reach the model beside the context.
        contexts.push(
          o.additionalContext,
          o.decision === 'block' ? o.reason : undefined,
          o.blocked ? o.blockReason : undefined,
        )
        replaced = replacementContent(toolName, o) ?? replaced
      }
      // `continue:false` ends the run after this call, its stopReason shown to the person.
      const stopped = outcomes.find((o) => o.continue === false)
      if (stopped) {
        const stopReason = stopped.stopReason?.trim() || 'A PostToolUse hook stopped the run.'
        emitNotice?.(stopReason, 'PostToolUse')
        stopRun?.({ event: 'PostToolUse', reason: stopReason })
      }
      const additionalContext = joinContext(contexts)
      return {
        ...(additionalContext ? { additionalContext } : {}),
        ...(replaced !== undefined ? { updatedToolOutput: replaced } : {}),
      }
    },

    async runPostToolUseFailure(tool, input, failure, toolUseId) {
      const ref = toolRefOf(tool)
      const toolName = ref.name
      const base = baseInput('PostToolUseFailure')
      const hookInput: CcHookInput = {
        ...base,
        ...claudeCodeHookCall(ref, input, base.cwd),
        ...(toolUseId ? { tool_use_id: toolUseId } : {}),
        error: failure.error,
        is_interrupt: failure.isInterrupt,
        ...(failure.durationMs !== undefined ? { duration_ms: failure.durationMs } : {}),
      }
      const outcomes = await runAll(
        'PostToolUseFailure',
        (m) => matchesToolName(m, toolName, ref.aliases, input),
        hookInput,
        false,
        { ifCtx: { toolName, toolInput: input, aliases: ref.aliases, cwd: base.cwd } },
      )
      // An exit-2 stderr and a `decision:"block"` reason are shown to Claude, as on PostToolUse:
      // the tool already failed, so neither can block anything.
      const additionalContext = joinContext(
        outcomes.flatMap((o) => [
          o.additionalContext,
          o.decision === 'block' ? o.reason : undefined,
          o.blocked ? o.blockReason : undefined,
        ]),
      )
      return additionalContext ? { additionalContext } : {}
    },
  }
}
