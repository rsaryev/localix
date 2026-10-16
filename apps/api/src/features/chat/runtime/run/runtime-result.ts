import { makeAbortError } from '@localixai/agent'
import type { AgentRuntimeResult } from '@localixai/agent/runtime'

/**
 * Runtime results are control flow, not telemetry. Adapters may also throw from
 * their event iterator, but the host must remain correct for an adapter that
 * reports a failed terminal only through `result`.
 */
export function requireCompletedRuntime(result: AgentRuntimeResult): void {
  if (result.terminal === 'completed') return
  if (result.terminal === 'aborted') {
    throw makeAbortError(result.error?.message ?? 'Agent runtime was aborted')
  }
  throw result.error ?? new Error('Agent runtime failed without an error')
}
