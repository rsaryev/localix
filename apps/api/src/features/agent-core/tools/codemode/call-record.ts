/**
 * The calls one `codemode` script made, for its card: what each was asked, how it ended, how long
 * it took. Nested calls raise no transcript items of their own, so this record is the person's only
 * view of what a script did — every call keeps what it was about (its path, its command), however
 * large its input. Long strings are shortened rather than the input dropped; past the per-call or
 * total size only that target is kept, and past the call count the record counts what it left out.
 * The results themselves stay in the script.
 */
export const CALL_RECORD_LIMITS = {
  maxCalls: 256,
  maxArgumentBytesPerCall: 8 * 1024,
  maxArgumentBytesTotal: 32 * 1024,
  /** A string argument longer than this is shortened, with how much was left out. */
  maxStringChars: 300,
  /** Entries kept of an array argument (a batch of files or edits). */
  maxArrayItems: 50,
  maxErrorChars: 500,
} as const

export type CodemodeCallStatus = 'running' | 'ok' | 'error' | 'cancelled'

export interface CodemodeCall {
  name: string
  /** The call's input, long strings shortened; only its target past the size limits. */
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
  /** False when a call was left out of `calls` or an input was shortened to its target. */
  complete: boolean
  /** Calls made past `maxCalls`, recorded by count only. */
  omittedCalls?: number
}

const encoder = new TextEncoder()

/** The input with long strings and arrays shortened, nested at most a few levels deep. */
function shorten(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    const over = value.length - CALL_RECORD_LIMITS.maxStringChars
    return over > 0
      ? `${value.slice(0, CALL_RECORD_LIMITS.maxStringChars)}… (${over} more characters)`
      : value
  }
  if (typeof value !== 'object' || value === null) return value
  if (depth >= 4) return Array.isArray(value) ? '[…]' : '{…}'
  if (Array.isArray(value)) {
    const kept = value.slice(0, CALL_RECORD_LIMITS.maxArrayItems).map((v) => shorten(v, depth + 1))
    const over = value.length - kept.length
    return over > 0 ? [...kept, `… (${over} more)`] : kept
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, v]) => [
      key,
      shorten(v, depth + 1),
    ]),
  )
}

/** What the card names a call by: its paths or its command, shortened. */
function targetOf(args: unknown): Record<string, unknown> | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const record = args as Record<string, unknown>
  const target: Record<string, unknown> = {}
  for (const key of ['path', 'command']) {
    if (typeof record[key] === 'string') target[key] = shorten(record[key])
  }
  for (const key of ['files', 'edits', 'paths']) {
    const entries = record[key]
    if (!Array.isArray(entries)) continue
    target[key] = entries.slice(0, CALL_RECORD_LIMITS.maxArrayItems).flatMap((entry) => {
      if (typeof entry === 'string') return [shorten(entry)]
      const path = (entry as { path?: unknown } | null)?.path
      return typeof path === 'string' ? [{ path: shorten(path) }] : []
    })
  }
  return Object.keys(target).length > 0 ? target : undefined
}

const sizeOf = (value: unknown) => encoder.encode(JSON.stringify(value ?? {})).length

export function createCallRecord() {
  const calls: CodemodeCall[] = []
  let complete = true
  let omittedCalls = 0
  let argumentBytes = 0

  /** The input as the record keeps it, within the per-call and total sizes. */
  const recorded = (args: unknown): unknown => {
    let kept: unknown = shorten(args ?? {})
    let bytes = sizeOf(kept)
    if (
      bytes > CALL_RECORD_LIMITS.maxArgumentBytesPerCall ||
      argumentBytes + bytes > CALL_RECORD_LIMITS.maxArgumentBytesTotal
    ) {
      complete = false
      kept = targetOf(args)
      bytes = sizeOf(kept)
    }
    argumentBytes += bytes
    return kept
  }

  return {
    /** Record a call as it starts; the returned `end` settles it. */
    start(name: string, args: unknown): (outcome: { error?: string }) => void {
      if (calls.length >= CALL_RECORD_LIMITS.maxCalls) {
        complete = false
        omittedCalls++
        return () => {}
      }
      const call: CodemodeCall = { name, status: 'running' }
      const kept = recorded(args)
      if (kept !== undefined) call.args = kept
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
        ...(omittedCalls > 0 ? { omittedCalls } : {}),
      }
    },
  }
}
