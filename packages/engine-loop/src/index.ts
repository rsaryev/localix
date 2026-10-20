/**
 * @localixai/engine-loop — the agent loop over a neutral model session.
 *
 * Knows conversations, turns and tools; knows no provider, wire protocol or SDK. Model access
 * hands it a `ModelSession` (`@localixai/agent/runtime`), the host hands it the run's tools and
 * hooks, and it returns the run as an event stream and a result.
 */
import type { AgentRuntimeRun } from '@localixai/agent/runtime'

import { runLoop, type LoopInput } from './loop'
import { startRun } from './run-handle'

export type { LoopInput } from './loop'

export interface AgentLoopOptions {
  /** Events held for a slow consumer before the loop waits for it. Default 256. */
  maxBufferedEvents?: number
}

/** Start one run of the loop. The result settles exactly once, failures and cancellation included. */
export function runAgentLoop(input: LoopInput, options: AgentLoopOptions = {}): AgentRuntimeRun {
  return startRun(
    {
      ...(input.signal ? { signal: input.signal } : {}),
      ...(options.maxBufferedEvents !== undefined
        ? { maxBufferedEvents: options.maxBufferedEvents }
        : {}),
    },
    (run) => runLoop(input, run),
  )
}
