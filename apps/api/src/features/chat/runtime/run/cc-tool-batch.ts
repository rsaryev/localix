/**
 * Claude Code's PostToolBatch on the loop's `afterToolBatch` seam: once every call of a response
 * has settled, before the next model request. A handler's `additionalContext` reaches the model
 * once, as a system reminder ahead of that request; a block (`decision:"block"`, `continue:false`,
 * exit 2) ends the run there, and its reason is shown as a hook notice in the transcript.
 */
import type { AgentRuntimeRunInput } from '@localixai/agent/runtime'

import type { CcHooksRuntime } from '../../../cc-hooks'
import { claudeCodeHookCall } from '../../../ext/cc-tool-shapes'
import { wrapSystemReminder } from '../system-reminder'

/** The `stoppedBy` name a PostToolBatch block ends the run under. */
export const POST_TOOL_BATCH_STOP = 'postToolBatchHook'

export function ccAfterToolBatch(
  ccHooks: CcHooksRuntime,
  onStop: (reason: string) => void,
): AgentRuntimeRunInput['afterToolBatch'] {
  if (!ccHooks.hasHooks('PostToolBatch')) return undefined
  return async ({ calls }) => {
    const verdict = await ccHooks.runPostToolBatch(
      calls.map((call) => ({
        ...claudeCodeHookCall({ name: call.toolName }, call.input),
        tool_use_id: call.toolCallId,
        // The content the model reads in the call's tool result.
        tool_response: call.result.content,
      })),
    )
    if (verdict.stop) {
      onStop(verdict.reason || 'A PostToolBatch hook stopped the run.')
      return { stop: POST_TOOL_BATCH_STOP }
    }
    if (!verdict.additionalContext) return undefined
    return {
      messages: [
        {
          role: 'user',
          content: wrapSystemReminder([verdict.additionalContext]),
          timestamp: Date.now(),
        },
      ],
    }
  }
}
