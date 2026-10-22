/**
 * The tool events of a per-run CC hooks runtime (`run.ts`): PreToolUse, PostToolUse and
 * PostToolUseFailure. PreToolUse and PostToolUse drive `select` + `fireAsync` + `runHandler`
 * by hand, because each handler sees the previous one's rewrite (and a deny cuts PreToolUse short).
 */
import { claudeCodeHookCall, localInputFromHook } from '../ext/cc-tool-shapes'
import type { CcHookEvent, CcHookHandler, CcHookInput, CcHookOutcome } from './contracts'
import { matchesToolName } from './matcher'
import type { CcHooksRuntime, PreToolUseResult } from './runtime-contracts'
import { contextFrom, joinContext } from './runtime-results'
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
  baseInput: <E extends CcHookEvent>(
    event: E,
  ) => { session_id: string; transcript_path: string; cwd: string; hook_event_name: E }
}

export function createToolHookRunners({
  select,
  runHandler,
  fireAsync,
  runAll,
  baseInput,
}: HookDispatchDeps): Pick<
  CcHooksRuntime,
  'runPreToolUse' | 'runPostToolUse' | 'runPostToolUseFailure'
> {
  return {
    async runPreToolUse(toolName: string, input: unknown, toolUseId?: string) {
      // Each handler sees the previous one's rewrite, and a deny cuts the chain —
      // neither fits `runAll`'s one-input/run-them-all contract.
      const selected = select('PreToolUse', (m) => matchesToolName(m, toolName), {
        ifCtx: { toolName, toolInput: input },
      })
      if (!selected) return { decision: 'proceed', didRewrite: false }
      // The hook reads the call as Claude Code names and shapes it (`Bash`, `file_path`).
      const inputFor = (toolInput: unknown): CcHookInput => ({
        ...baseInput('PreToolUse'),
        ...claudeCodeHookCall({ name: toolName }, toolInput),
        ...(toolUseId ? { tool_use_id: toolUseId } : {}),
      })
      // async PreToolUse hooks can't block (fire against the pre-rewrite input).
      fireAsync(selected.async, inputFor(input))
      let effectiveInput = input
      let didRewrite = false
      let decision: PreToolUseResult['decision'] = 'proceed'
      for (const h of selected.sync) {
        const o = await runHandler('PreToolUse', h, inputFor(effectiveInput), false)
        if (
          o.blocked ||
          o.decision === 'block' ||
          o.continue === false ||
          o.permissionDecision === 'deny'
        ) {
          return {
            decision: 'deny',
            reason:
              o.blockReason ||
              o.permissionDecisionReason ||
              o.reason ||
              o.stopReason ||
              'Tool call denied by hook',
            didRewrite,
            ...(didRewrite ? { updatedInput: effectiveInput } : {}),
          }
        }
        if ('updatedInput' in o && o.updatedInput !== undefined) {
          effectiveInput = localInputFromHook(toolName, effectiveInput, o.updatedInput)
          didRewrite = true
        }
        // allow beats ask beats proceed (deny already returned above).
        if (o.permissionDecision === 'allow') decision = 'allow'
        else if (o.permissionDecision === 'ask' && decision !== 'allow') decision = 'ask'
      }
      return { decision, didRewrite, ...(didRewrite ? { updatedInput: effectiveInput } : {}) }
    },

    async runPostToolUse(
      toolName: string,
      input: unknown,
      result: { content: string; details?: unknown },
    ) {
      // Each handler observes the previous one's output replacement — same reason as
      // PreToolUse for driving the dispatch by hand.
      const selected = select('PostToolUse', (m) => matchesToolName(m, toolName), {
        ifCtx: { toolName, toolInput: input },
      })
      if (!selected) return {}
      const inputFor = (content: string): CcHookInput => ({
        ...baseInput('PostToolUse'),
        ...claudeCodeHookCall({ name: toolName }, input),
        tool_response: { content, details: result.details },
      })
      fireAsync(selected.async, inputFor(result.content))
      const contexts: (string | undefined)[] = []
      // Last non-empty updatedToolOutput wins; later hooks observe the replaced
      // content (mirrors the native onPostToolCall replaceContent chain).
      let replaced: string | undefined
      for (const h of selected.sync) {
        const o = await runHandler('PostToolUse', h, inputFor(replaced ?? result.content), false)
        // PostToolUse cannot block (tool already ran); we surface reason + context.
        contexts.push(o.additionalContext, o.decision === 'block' ? o.reason : undefined)
        if (typeof o.updatedToolOutput === 'string' && o.updatedToolOutput.trim()) {
          replaced = o.updatedToolOutput
        }
      }
      const additionalContext = joinContext(contexts)
      return {
        ...(additionalContext ? { additionalContext } : {}),
        ...(replaced !== undefined ? { updatedToolOutput: replaced } : {}),
      }
    },

    async runPostToolUseFailure(toolName, input, failure) {
      const hookInput: CcHookInput = {
        ...baseInput('PostToolUseFailure'),
        ...claudeCodeHookCall({ name: toolName }, input),
        error: failure.error,
        is_interrupt: failure.isInterrupt,
      }
      const additionalContext = contextFrom(
        await runAll('PostToolUseFailure', (m) => matchesToolName(m, toolName), hookInput, false, {
          ifCtx: { toolName, toolInput: input },
        }),
      )
      return additionalContext ? { additionalContext } : {}
    },
  }
}
