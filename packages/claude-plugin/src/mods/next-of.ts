import type { Meter } from './budget'
import type { HookOrigin, Next, TargetTier } from './chain'
import { matchesEventName } from './matcher'
import { openStream, type OpenStream, type Outcome } from './stream'
import type { TraceEntry } from './trace'

/**
 * The `next` one hook run receives: a call that runs what is beneath (a promise, or on a streaming
 * event the stream beneath), `next.to`, its signal and origin, its budget read fresh, the event's
 * name and `is`, and `trace` — what settled beneath its latest call.
 */

/** One `next` call: what it settles to, and the stream the hook reads it through. */
export interface Call {
  outcome: Promise<Outcome>
  stream?: OpenStream
}

/** What a `next` call runs: an Outcome, and the chunk its stream starts at (a replay continues). */
export type Open = (
  event: unknown,
  tier?: TargetTier,
) => { outcome: Promise<Outcome>; start: number }

export function nextOf(input: {
  event: string
  /** Whether the event streams (`turn.step`): `next(e)` is then a stream. */
  streams: boolean
  origin: HookOrigin
  meter: Meter
  ms: number
  extra: object
  open: Open
  record: (call: Call) => void
  signal: AbortSignal
}): Next {
  const { event, meter, open, record } = input
  let trace: readonly TraceEntry[] = []
  let latest: Promise<void> | undefined
  const call = (e: unknown, tier?: TargetTier) => {
    const { outcome, start } = open(e, tier)
    // The trace of the latest call: what settled beneath, filled once it settles.
    trace = []
    const mine = outcome.then((settled) => {
      if (latest === mine) trace = settled.trace ?? []
    })
    latest = mine
    mine.catch(() => {})
    const paused = meter.pause(outcome)
    if (!input.streams) {
      record({ outcome })
      return paused.then((settled) => settled.value)
    }
    const stream = openStream(paused, start)
    record({ outcome, stream })
    return stream
  }
  const budget = {
    ms: input.ms,
    get remainingMs() {
      return meter.remainingMs()
    },
  }
  const next = Object.assign((e?: unknown) => call(e), {
    to: (e: unknown, tier: TargetTier) => call(e, tier),
    signal: input.signal,
    origin: input.origin,
    budget,
    event,
    is: (pattern: unknown) => matchesEventName(String(pattern), event),
    ...input.extra,
  })
  // Read fresh: the trace of the latest call, once it settled.
  return Object.defineProperty(next, 'trace', { get: () => trace }) as unknown as Next
}
