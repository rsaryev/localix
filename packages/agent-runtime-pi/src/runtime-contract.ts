import type { AgentRuntimeRunInput } from '@localixai/agent/runtime'
import type { PiModelMiddleware } from './middleware'
import type { StopCondition } from './stop-conditions'
import type { PiRequestTuning } from './stream-options'

export interface PiRuntimeOptions extends PiRequestTuning {
  maxBufferedEvents?: number
  /**
   * Deployment-wide middleware, applied OUTSIDE any per-run entry. A watchdog or a
   * provider-quirk shim is a property of the deployment, not of one run, so it must not
   * depend on every call site remembering to pass it — and being outermost means a per-run
   * entry cannot bypass it.
   */
  middleware?: readonly PiModelMiddleware[]
}

/**
 * Pi-adapter extension of the agnostic run input. The hook types are pi-shaped (they see
 * pi's stream params and turn ledger), so they live here rather than in the agnostic
 * runtime port — a host that wants them imports this adapter's types explicitly. Every
 * field is optional: a plain {@link AgentRuntimeRunInput} runs byte-identically.
 */
export interface PiAgentRuntimeRunInput extends AgentRuntimeRunInput {
  /** Composed around the resolved model's stream call; absent or `[]` leaves it untouched. */
  middleware?: readonly PiModelMiddleware[]
  /** Extra turn-boundary stop rules, evaluated after the built-in turn budget. */
  stopConditions?: readonly StopCondition[]
}
