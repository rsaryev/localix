import type { AgentToolExecutionContext } from '@localixai/agent/agents'

import { runCall, type CallEnvironment } from './call'

type CallTool = NonNullable<AgentToolExecutionContext['callTool']>

/**
 * Tool calls a tool makes on its own behalf (`AgentToolExecutionContext.callTool`): the same
 * resolve → admit → execute stages a model's call goes through — validation, the tool's guard,
 * the permission gate, the after-hook — without the run's events. A nested call's id is its
 * parent's plus a sequence number (`call_1/3`), unique in the run and readable back to its caller.
 */
export function createNestedCalls(
  environment: () => CallEnvironment,
  runSignal: AbortSignal,
): (parentToolCallId: string) => CallTool {
  const sequence = new Map<string, number>()
  return (parentToolCallId) => async (name, input, signal) => {
    const n = (sequence.get(parentToolCallId) ?? 0) + 1
    sequence.set(parentToolCallId, n)
    const { result } = await runCall(
      environment(),
      { id: `${parentToolCallId}/${n}`, name, arguments: input ?? {} },
      signal ? AbortSignal.any([runSignal, signal]) : runSignal,
    )
    return { result, isError: result.isError === true }
  }
}
