import type { AgentErrorInfo } from '@localixai/agent/agents'

/**
 * Engine-neutral result of one Localix run envelope.
 *
 * Provider/runtime details stay behind the adapter. Queue and scheduler
 * consumers only need to know whether the requested work finished, failed
 * terminally, or handed ownership to a bounded continuation.
 */
export type RunExecutionOutcome =
  | { status: 'completed' }
  | { status: 'continued' }
  | { status: 'delegated'; message: string }
  | {
      status: 'failed'
      kind: AgentErrorInfo['kind']
      message: string
      retryable: boolean
      rateLimited: boolean
    }

export type TerminalRunExecutionOutcome = Exclude<RunExecutionOutcome, { status: 'continued' }>

export const completedRun = (): Extract<RunExecutionOutcome, { status: 'completed' }> => ({
  status: 'completed',
})

export const continuedRun = (): Extract<RunExecutionOutcome, { status: 'continued' }> => ({
  status: 'continued',
})

export function failedRun(
  info: AgentErrorInfo,
): Extract<RunExecutionOutcome, { status: 'failed' }> {
  return {
    status: 'failed',
    kind: info.kind,
    message: info.userMessage,
    retryable: info.retryable,
    rateLimited: info.rateLimited === true,
  }
}

/** A queued turn that will never run: removed, cancelled, or with nobody to answer it. */
export const dismissedRun = (
  message: string,
): Extract<RunExecutionOutcome, { status: 'failed' }> => ({
  status: 'failed',
  kind: 'dismissed',
  message,
  retryable: false,
  rateLimited: false,
})

/** A delivery that threw where no run could classify the error. */
export const fatalRun = (error: unknown): Extract<RunExecutionOutcome, { status: 'failed' }> => ({
  status: 'failed',
  kind: 'fatal',
  message: error instanceof Error ? error.message : String(error),
  retryable: false,
  rateLimited: false,
})

/**
 * One logical completion shared by every continuation segment.
 *
 * A physical `executeRun` segment must return before a queued child can acquire
 * the session drain lease. The wake queue carries this process-local deferred
 * across segments and resolves it only at the logical chain's terminal outcome.
 */
export interface RunCompletion {
  readonly promise: Promise<TerminalRunExecutionOutcome>
  settle(outcome: TerminalRunExecutionOutcome): void
}

export function createRunCompletion(): RunCompletion {
  let settled = false
  let resolve!: (outcome: TerminalRunExecutionOutcome) => void
  const promise = new Promise<TerminalRunExecutionOutcome>((resolvePromise) => {
    resolve = resolvePromise
  })
  return {
    promise,
    settle(outcome) {
      if (settled) return
      settled = true
      resolve(outcome)
    },
  }
}
