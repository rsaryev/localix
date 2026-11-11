import { absoluteFilePaths, claudeCodeToolResponse } from '../../../ext/cc-tool-shapes'
import type { CcHookToolRef, CcHooksRuntime } from '../../../cc-hooks/runtime-contracts'
import { replacementContent } from '../../../cc-hooks/tool-output-replacement'
import { claudeText, type EventDeps } from './runtime'
import { claudeCodeHookCall, localInputFromHook } from '../tool-calls'

type ToolEvents = Pick<
  CcHooksRuntime,
  | 'runPreToolUse'
  | 'runPostToolUse'
  | 'runPostToolUseFailure'
  | 'runPermissionRequest'
  | 'runPermissionDenied'
  | 'runPostToolBatch'
>

const refOf = (tool: CcHookToolRef): Exclude<CcHookToolRef, string> =>
  typeof tool === 'string' ? { name: tool } : tool

/**
 * The tool events: a call's input in Claude Code's shape (`claudeCodeHookCall`), and a hook's
 * `updatedInput` folded back into Localix's (`localInputFromHook`). `tool_name` is Localix's (an
 * MCP tool's Claude Code address): the session names it as Claude Code does (`toolNames`).
 */
export function createToolEvents({ fire, cwd, stop }: EventDeps): ToolEvents {
  const callOf = (tool: CcHookToolRef, input: unknown) => {
    const ref = refOf(tool)
    const { tool_input, mcp_server } = claudeCodeHookCall(ref, input, cwd)
    return {
      name: ref.name,
      facts: {
        tool_name: ref.aliases?.[0] ?? ref.name,
        tool_input: tool_input as Record<string, unknown>,
        ...(mcp_server ? { mcp_server } : {}),
      },
    }
  }
  return {
    async runPreToolUse(tool, input, toolUseId) {
      const call = callOf(tool, input)
      const outcome = await fire('PreToolUse', { ...call.facts, tool_use_id: toolUseId ?? '' })
      if (!outcome) return { decision: 'proceed', didRewrite: false }
      const { effects } = outcome
      const additionalContext = claudeText({ ...outcome, block: undefined })
      const rewritten =
        effects.updatedInput === undefined
          ? { didRewrite: false }
          : {
              didRewrite: true,
              updatedInput: localInputFromHook(call.name, input, effects.updatedInput, cwd),
            }
      const more = { ...rewritten, ...(additionalContext ? { additionalContext } : {}) }
      if (!outcome.continue) {
        const reason = outcome.stopReason?.trim() || 'A PreToolUse hook stopped the run.'
        return { decision: 'deny', reason, stop: { reason }, ...more }
      }
      if (!outcome.proceed || effects.permissionDecision === 'deny')
        return {
          decision: 'deny',
          reason:
            effects.permissionDecisionReason || outcome.block?.reason || 'Tool call denied by hook',
          ...more,
        }
      const decision = effects.permissionDecision
      if (decision !== 'ask' && decision !== 'allow') return { decision: 'proceed', ...more }
      const reason = effects.permissionDecisionReason
      return { decision, ...(reason ? { reason } : {}), ...more }
    },

    async runPostToolUse(tool, input, result, toolUseId, durationMs) {
      const call = callOf(tool, input)
      const outcome = await fire('PostToolUse', {
        ...call.facts,
        tool_use_id: toolUseId ?? '',
        tool_response: claudeCodeToolResponse({ name: call.name }, result, input, cwd),
        ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
      })
      const additionalContext = claudeText(outcome)
      const replaced = outcome && replacementContent(call.name, outcome.effects.updatedToolOutput)
      return {
        ...(additionalContext ? { additionalContext } : {}),
        ...(replaced === undefined ? {} : { updatedToolOutput: replaced }),
      }
    },

    async runPostToolUseFailure(tool, input, failure, toolUseId) {
      const call = callOf(tool, input)
      const outcome = await fire('PostToolUseFailure', {
        ...call.facts,
        tool_use_id: toolUseId ?? '',
        error: failure.error,
        is_interrupt: failure.isInterrupt,
        ...(failure.durationMs === undefined ? {} : { duration_ms: failure.durationMs }),
      })
      const additionalContext = claudeText(outcome)
      return additionalContext ? { additionalContext } : {}
    },

    async runPermissionRequest(tool, input, more) {
      const call = callOf(tool, input)
      const outcome = await fire('PermissionRequest', {
        ...call.facts,
        ...(more?.suggestions?.length ? { permission_suggestions: more.suggestions as never } : {}),
      })
      const decision = outcome?.effects.permissionRequest
      if (!decision) return {}
      const { updatedInput, ...rest } = decision as typeof decision & { updatedInput?: unknown }
      return {
        ...(rest as object),
        ...(updatedInput === undefined
          ? {}
          : { updatedInput: localInputFromHook(call.name, input, updatedInput, cwd) }),
      }
    },

    async runPermissionDenied(tool, input, toolUseId, reason) {
      const call = callOf(tool, input)
      const outcome = await fire('PermissionDenied', {
        ...call.facts,
        tool_use_id: toolUseId,
        reason,
      })
      return { retry: outcome?.effects.retry === true }
    },

    async runPostToolBatch(calls) {
      const outcome = await fire('PostToolBatch', {
        tool_calls: calls.map((one) => ({
          ...one,
          tool_input: absoluteFilePaths(one.tool_name, one.tool_input, cwd) as Record<
            string,
            unknown
          >,
        })),
      })
      const additionalContext = claudeText(outcome ? { ...outcome, block: undefined } : undefined)
      const stopping = outcome !== undefined && (!outcome.continue || !outcome.proceed)
      const reason = outcome?.stopReason?.trim() || outcome?.block?.reason
      // A block stops the run as `continue: false` does (`fire` reports that one).
      if (stopping && outcome.continue)
        stop({ event: 'PostToolBatch', reason: reason || 'A PostToolBatch hook stopped the run.' })
      return {
        stop: stopping,
        ...(stopping && reason ? { reason } : {}),
        ...(additionalContext ? { additionalContext } : {}),
      }
    },
  }
}
