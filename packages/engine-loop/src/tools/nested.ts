import type { AgentToolExecutionContext } from '@localixai/agent/agents'

import type { EmitEvent } from '../run-handle'
import { runNestedCall, type CallEnvironment, type ToolCallRequest } from './call'
import { DEFERRED_TEXT, messageWaits } from './results'

type CallTool = NonNullable<AgentToolExecutionContext['callTool']>

/**
 * Tool calls a tool makes on its own behalf (`AgentToolExecutionContext.callTool`): the same
 * resolve → admit → execute stages a model's call goes through — validation, the tool's guard,
 * the permission gate (told the parent), the tool's own wrappers and the host's result shield —
 * without the run's events. What only the model reads stays out of the result the calling tool
 * gets back: the gate's note and the after-hook (`NestedCaller`). A nested call's id is its
 * parent's plus a sequence number (`call_1/3`), unique in the run and readable back to its caller.
 *
 * A message the person sends while a script runs outranks the calls the script has yet to make,
 * as it outranks a model's queued calls: from then on each call comes back unrun and says why, so
 * the script ends and the model reads the message, instead of the script working on for minutes.
 */
export function createNestedCalls(
  environment: () => CallEnvironment,
  runSignal: AbortSignal,
  emit?: EmitEvent,
  shouldDefer?: () => boolean | Promise<boolean>,
): (parent: ToolCallRequest) => CallTool {
  return (parent) => {
    // Bound to one parent call, so the count lives and dies with it.
    let sequence = 0
    return async (name, input, signal) => {
      sequence += 1
      if (await messageWaits(shouldDefer))
        return { result: { content: DEFERRED_TEXT, isError: true }, isError: true }
      const scoped = either(runSignal, signal)
      try {
        const { result } = await runNestedCall(
          environment(),
          { id: `${parent.id}/${sequence}`, name, arguments: input ?? {} },
          scoped.signal,
          { parent: { id: parent.id, name: parent.name }, ...(emit ? { emit } : {}) },
        )
        return { result, isError: result.isError === true }
      } finally {
        scoped.dispose()
      }
    }
  }
}

/**
 * A signal that aborts with either one, whose listeners come off when the call is done: a script
 * may make thousands of calls in one run, and none should leave a listener on the run's signal.
 */
function either(run: AbortSignal, own: AbortSignal | undefined) {
  if (!own) return { signal: run, dispose: () => {} }
  const controller = new AbortController()
  const abort = (source: AbortSignal) => () => controller.abort(source.reason)
  const onRun = abort(run)
  const onOwn = abort(own)
  if (run.aborted) onRun()
  else if (own.aborted) onOwn()
  run.addEventListener('abort', onRun, { once: true })
  own.addEventListener('abort', onOwn, { once: true })
  return {
    signal: controller.signal,
    dispose: () => {
      run.removeEventListener('abort', onRun)
      own.removeEventListener('abort', onOwn)
    },
  }
}
