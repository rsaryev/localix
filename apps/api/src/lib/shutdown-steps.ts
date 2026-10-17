import { withTimeout } from './timeout'

/**
 * The bounded, failure-tolerant step runner behind the API's graceful teardown.
 *
 * Every step gets its own budget, and a step that throws or overruns is REPORTED, not raised.
 * The teardown used to collect those failures and reject with an AggregateError, which the signal
 * handler turned into `exit(1)`. The desktop shell reads a non-zero exit as a crash and starts the
 * runtime again — so a terminal that warned about leaked disposables, or a listener that took a
 * little long to close, turned a deliberate stop into a restart. The process is leaving either
 * way; what a failed step owes is a warning in the log, never a different exit code.
 */
export interface ShutdownStepFailure {
  step: string
  error: unknown
}

export interface ShutdownSteps {
  /** Run one step within `timeoutMs` (default: the runner's per-step budget). Never throws. */
  run(step: string, operation: () => unknown, timeoutMs?: number): Promise<void>
  /** Every step that failed or overran, in order. */
  failures(): readonly ShutdownStepFailure[]
}

export function createShutdownSteps(
  stepMs: number,
  onFailure: (failure: ShutdownStepFailure) => void = () => {},
): ShutdownSteps {
  const failed: ShutdownStepFailure[] = []
  return {
    async run(step, operation, timeoutMs = stepMs) {
      try {
        // The async wrapper is load-bearing: it turns a SYNCHRONOUS throw from `operation()`
        // into a rejection, so a step that fails before its first await is still recorded.
        await withTimeout((async () => operation())(), timeoutMs, step)
      } catch (error) {
        const failure = { step, error }
        failed.push(failure)
        try {
          onFailure(failure)
        } catch {
          // A reporter that throws (a closed log sink) must not end the teardown.
        }
      }
    },
    failures: () => failed,
  }
}
