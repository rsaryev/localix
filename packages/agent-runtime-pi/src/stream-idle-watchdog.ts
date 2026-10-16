import type { AssistantMessageEventStream } from '@earendil-works/pi-ai'

import type { PiModelMiddleware, PiStreamParams } from './middleware'

/**
 * A deadline on provider SILENCE, as opposed to a deadline on the whole request.
 *
 * Before this, the only ceiling was pi's SDK transport default (~10 minutes) — the host
 * never set one — so a provider that accepted the request and then went quiet stalled the
 * run for ten minutes with nothing to show. `classifyAgentError` already had the branch for
 * this failure (it matches `StreamIdleTimeoutError` by name, deliberately avoiding a
 * dependency on this adapter); what was missing was anything that produced it.
 *
 * A total deadline is the wrong instrument: a large refactor answer legitimately streams for
 * minutes, and killing it would be worse than the stall. What is never legitimate is a long
 * gap BETWEEN chunks, so the deadline is rearmed on every event and only silence accumulates.
 *
 * The two phases are genuinely different failures, so they get different budgets:
 *   - before the first event, the model is THINKING. A reasoning model at high effort over a
 *     large context can be quiet for a long time and still be working.
 *   - after tokens have started flowing, a long gap is a stall.
 *
 * Failure is a THROW, not a protocol event, and that is deliberate: pi does not wrap the
 * stream call, so a throw propagates out of `runAgentLoop` into the run's own error path,
 * where the classifier reads it. Fabricating an `error` event instead would require
 * inventing an `AssistantMessage` the provider never sent.
 */

/** The model may think this long before its first token. */
const DEFAULT_FIRST_EVENT_TIMEOUT_MS = 300_000
/** Once tokens flow, a gap this long is a stall rather than progress. */
const DEFAULT_IDLE_TIMEOUT_MS = 120_000

export interface StreamIdleWatchdogOptions {
  firstEventTimeoutMs?: number
  idleTimeoutMs?: number
}

/** Named so `classifyAgentError` can recognise it without importing this adapter. */
export class StreamIdleTimeoutError extends Error {
  constructor(waitedMs: number, phase: 'first-event' | 'mid-stream') {
    super(
      phase === 'first-event'
        ? `The provider accepted the request but sent nothing for ${Math.round(waitedMs / 1000)}s`
        : `The provider stopped sending data ${Math.round(waitedMs / 1000)}s into the response`,
    )
    this.name = 'StreamIdleTimeoutError'
  }
}

/**
 * Middleware enforcing the silence deadline.
 *
 * It replaces the returned stream's ITERATOR only. `push`, `end` and `result` stay pi's own,
 * on pi's own object, so everything except the pace of iteration is untouched — a smaller,
 * more faithful change than re-pumping every event into a second stream.
 */
export function streamIdleWatchdog(options: StreamIdleWatchdogOptions = {}): PiModelMiddleware {
  const firstEventTimeoutMs = options.firstEventTimeoutMs ?? DEFAULT_FIRST_EVENT_TIMEOUT_MS
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS

  return {
    wrapStreamSimple: async ({ params, doStreamSimple }) => {
      // Our own controller, chained to the caller's: the watchdog must be able to release
      // the provider connection on its own, without taking the caller's ability to cancel.
      const controller = new AbortController()
      const callerSignal = params.options?.signal
      const signal = callerSignal
        ? AbortSignal.any([callerSignal, controller.signal])
        : controller.signal

      const upstream = await doStreamSimple(withSignal(params, signal))
      return withIdleDeadline(upstream, {
        controller,
        signal,
        firstEventTimeoutMs,
        idleTimeoutMs,
      })
    },
  }
}

function withSignal(params: PiStreamParams, signal: AbortSignal): PiStreamParams {
  return { ...params, options: { ...params.options, signal } }
}

function withIdleDeadline(
  stream: AssistantMessageEventStream,
  input: {
    controller: AbortController
    signal: AbortSignal
    firstEventTimeoutMs: number
    idleTimeoutMs: number
  },
): AssistantMessageEventStream {
  const iterate = stream[Symbol.asyncIterator].bind(stream)
  stream[Symbol.asyncIterator] = async function* () {
    const upstream = iterate()
    let sawEvent = false
    let finished = false
    try {
      for (;;) {
        const budget = sawEvent ? input.idleTimeoutMs : input.firstEventTimeoutMs
        input.signal.throwIfAborted()
        const next = await raceDeadline(upstream.next(), budget, input.signal)
        if (next === TIMED_OUT) {
          // Release the provider connection before surfacing the failure: an abandoned
          // stream would otherwise keep the socket (and its cost) for the full transport
          // deadline we exist to pre-empt.
          input.controller.abort()
          throw new StreamIdleTimeoutError(budget, sawEvent ? 'mid-stream' : 'first-event')
        }
        if (next.done) {
          finished = true
          return
        }
        sawEvent = true
        yield next.value
      }
    } finally {
      if (!finished) input.controller.abort()
      // Ask the upstream iterator to finish, but do NOT await it — and that is the whole
      // point. Quiescence of the provider stream is achieved by the ABORT above (the
      // transport closes); this call is bookkeeping. Awaiting it would hang precisely in
      // the case this watchdog exists for: a stuck upstream has a `next()` still pending,
      // so its `return()` may never settle, and the timeout would never surface.
      void Promise.resolve()
        .then(() => upstream.return?.())
        .catch(() => {
          /* the upstream is already gone or stuck; the abort is what mattered */
        })
    }
  }
  return stream
}

const TIMED_OUT = Symbol('timed-out')

/**
 * Resolve with the awaited value, or `TIMED_OUT` once the budget elapses. The timer is
 * cleared on both paths — a pending timer per event would otherwise keep the event loop
 * alive for the whole budget after a fast stream finished.
 */
async function raceDeadline<T>(
  promise: Promise<T>,
  budgetMs: number,
  signal: AbortSignal,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason)
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      }),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), budgetMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}
