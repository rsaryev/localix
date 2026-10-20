/**
 * The calls one `codemode` script made, for its card: what each was asked, how it ended, how long
 * it took. pi's `NestedCallRecorder` (`coding-agent/src/core/nested-tool-calls.ts`) with its limits:
 * arguments over the per-call or total size are left out, calls past the count are dropped, and the
 * record says when either happened. The results themselves stay in the script.
 */
export const CALL_RECORD_LIMITS = {
  maxCalls: 256,
  maxArgumentBytesPerCall: 8 * 1024,
  maxArgumentBytesTotal: 32 * 1024,
  maxErrorChars: 500,
} as const

export type CodemodeCallStatus = 'running' | 'ok' | 'error' | 'cancelled'

export interface CodemodeCall {
  name: string
  /** The call's input; absent when it was over the size limits. */
  args?: unknown
  status: CodemodeCallStatus
  /** Whole milliseconds, once the call has ended. */
  durationMs?: number
  /** The error the script received, truncated. */
  error?: string
}

/** What a `codemode` result carries for its card. */
export interface CodemodeDetails {
  calls: CodemodeCall[]
  /** False when a call or its arguments were left out of `calls`. */
  complete: boolean
}

const encoder = new TextEncoder()

export function createCallRecord() {
  const calls: CodemodeCall[] = []
  let complete = true
  let argumentBytes = 0

  return {
    /** Record a call as it starts; the returned `end` settles it. */
    start(name: string, args: unknown): (outcome: { error?: string }) => void {
      if (calls.length >= CALL_RECORD_LIMITS.maxCalls) {
        complete = false
        return () => {}
      }
      const call: CodemodeCall = { name, status: 'running' }
      const json = JSON.stringify(args ?? {})
      const bytes = encoder.encode(json).length
      if (
        bytes <= CALL_RECORD_LIMITS.maxArgumentBytesPerCall &&
        argumentBytes + bytes <= CALL_RECORD_LIMITS.maxArgumentBytesTotal
      ) {
        call.args = JSON.parse(json)
        argumentBytes += bytes
      } else complete = false
      calls.push(call)
      const started = performance.now()
      return ({ error }) => {
        call.durationMs = Math.round(performance.now() - started)
        call.status = error === undefined ? 'ok' : 'error'
        if (error) call.error = error.slice(0, CALL_RECORD_LIMITS.maxErrorChars)
      }
    },
    /** The record as the script left it: a call still running when it ended was cancelled. */
    snapshot(): CodemodeDetails {
      return {
        calls: calls.map((call) =>
          call.status === 'running' ? { ...call, status: 'cancelled' } : { ...call },
        ),
        complete,
      }
    },
  }
}
