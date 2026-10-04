/**
 * When, and how fast, the REST ticker may poll.
 *
 * The venue websocket is the real ticker feed. This poll is the fallback for when it is down, and on
 * a venue whose `fetchTicker` is EMULATED it is an expensive fallback: ccxt synthesizes such a read
 * from a bulk one, which sits in the venue's SERIAL throttle queue for seconds while every other read
 * — the chart's own candle history among them — waits behind it.
 *
 * So the cost must be known before the first read, and an UNKNOWN cost is not a cheap one. `emulated`
 * is `undefined` until the exchange's capabilities have loaded (and stays `undefined` if that load
 * failed). The poll stays OFF for as long as it is unknown: the stream still feeds the ticker, and
 * guessing "native" here is what fires a thirteen-second read at mount and starves the history load
 * queued behind it.
 *
 * Pure, so the three rules — never once the stream is actually feeding, never at an unknown cost, and
 * never immediately at a known-expensive one — are unit-tested rather than asserted in a comment.
 */
export interface TickerPollPlan {
  enabled: boolean
  intervalMs: number
  /** Fire once at mount. Only ever true for a read we know is cheap. */
  immediate: boolean
}

/** How slowly to poll when the venue's `fetchTicker` is EMULATED — a deep fallback, not a feed. */
export const EMULATED_FALLBACK_MS = 30_000

export function tickerPollPlan(input: {
  /** The caller wants a ticker at all (a connection and a symbol are selected). */
  enabled: boolean
  /**
   * The venue websocket has DELIVERED this symbol's ticker at least once — not merely that the
   * subscription is up.
   *
   * The stream registry declares a stream `live` 800ms after its loop starts, which proves the
   * socket connected, not that this symbol prints. Pausing the fallback on that alone leaves a quiet
   * market with no price at all, forever: the poll is off because the stream is "live", and the
   * stream is silent. The headline number on the chart is the one thing that must not depend on a
   * market being busy.
   */
  streamHasDelivered: boolean
  /** `true` = the single-ticker read is synthesized from a bulk one; `undefined` = not yet known. */
  emulated: boolean | undefined
  /** Poll interval for a cheap, native read. */
  intervalMs: number
}): TickerPollPlan {
  const known = input.emulated !== undefined
  return {
    enabled: input.enabled && !input.streamHasDelivered && known,
    intervalMs: input.emulated ? EMULATED_FALLBACK_MS : input.intervalMs,
    immediate: input.emulated === false,
  }
}
