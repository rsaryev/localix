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
import { contextFrom, joinContext } from './runtime-results'
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
      const selected = select('PreToolUse', (m) => matchesToolName(m, toolName, ref.aliases), {
        ifCtx: { toolName, toolInput: input, aliases: ref.aliases },
      })
      if (!selected) return { decision: 'proceed', didRewrite: false }
      // The hook reads the call as Claude Code names and shapes it (`Bash`, `file_path`).
      const base = baseInput('PreToolUse')
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
      for (const h of selected.sync) {
        const o = await runHandler('PreToolUse', h, inputFor(effectiveInput), false)
        contexts.push(o.additionalContext)
        // `continue:false` "takes precedence over any event-specific decision fields": the call
        // does not run, processing stops, and the stopReason is shown to the person.
        if (o.continue === false) {
          const stopReason = o.stopReason?.trim() || 'A PreToolUse hook stopped the run.'
          emitNotice?.(stopReason, 'PreToolUse')
          stopRun?.({ event: 'PreToolUse', reason: stopReason })
          return {
            decision: 'deny',
            reason: stopReason,
            stop: { reason: stopReason },
            ...rewritten(),
          }
        }
        if (o.blocked || o.decision === 'block' || o.permissionDecision === 'deny') {
          return {
            decision: 'deny',
            reason:
              o.blockReason ||
              o.permissionDecisionReason ||
              o.reason ||
              // hookify's block gives its rule's text only as the `systemMessage`.
              o.systemMessage?.trim() ||
              'Tool call denied by hook',
            ...rewritten(),
          }
        }
        if ('updatedInput' in o && o.updatedInput !== undefined) {
          effectiveInput = localInputFromHook(toolName, effectiveInput, o.updatedInput, base.cwd)
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
    ) {
      const ref = toolRefOf(tool)
      const toolName = ref.name
      // Each handler observes the previous one's output replacement — same reason as
      // PreToolUse for driving the dispatch by hand.
      const selected = select('PostToolUse', (m) => matchesToolName(m, toolName, ref.aliases), {
        ifCtx: { toolName, toolInput: input, aliases: ref.aliases },
      })
      if (!selected) return {}
      const base = baseInput('PostToolUse')
      // A replaced output reaches the next hook as the whole response (its own details are gone).
      const inputFor = (content: string, replaced: boolean): CcHookInput => ({
        ...base,
        ...claudeCodeHookCall(ref, input, base.cwd),
        tool_response: claudeCodeToolResponse(
          { name: toolName },
          replaced ? { content } : { content, details: result.details },
        ),
        ...(toolUseId ? { tool_use_id: toolUseId } : {}),
      })
      fireAsync(selected.async, inputFor(result.content, false))
      const contexts: (string | undefined)[] = []
      // Last replacement in the tool's shape wins; later hooks observe the replaced
      // content (mirrors the native onPostToolCall replaceContent chain).
      let replaced: string | undefined
      for (const h of selected.sync) {
        const o = await runHandler(
          'PostToolUse',
          h,
          inputFor(replaced ?? result.content, replaced !== undefined),
          false,
        )
        // PostToolUse cannot block (tool already ran); we surface reason + context.
        contexts.push(o.additionalContext, o.decision === 'block' ? o.reason : undefined)
        replaced = replacementContent(toolName, o) ?? replaced
      }
      const additionalContext = joinContext(contexts)
      return {
        ...(additionalContext ? { additionalContext } : {}),
        ...(replaced !== undefined ? { updatedToolOutput: replaced } : {}),
      }
    },

    async runPostToolUseFailure(tool, input, failure) {
      const ref = toolRefOf(tool)
      const toolName = ref.name
      const base = baseInput('PostToolUseFailure')
      const hookInput: CcHookInput = {
        ...base,
        ...claudeCodeHookCall(ref, input, base.cwd),
        error: failure.error,
        is_interrupt: failure.isInterrupt,
      }
      const additionalContext = contextFrom(
        await runAll(
          'PostToolUseFailure',
          (m) => matchesToolName(m, toolName, ref.aliases),
          hookInput,
          false,
          { ifCtx: { toolName, toolInput: input, aliases: ref.aliases } },
        ),
      )
      return additionalContext ? { additionalContext } : {}
    },
  }
}
