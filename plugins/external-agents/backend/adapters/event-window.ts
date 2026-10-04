/**
 * The bounded window every adapter reads a transcript through.
 *
 * ── Why it exists ─────────────────────────────────────────────────────────────────────────────
 *
 * Four adapters each spelled the same rule in their own shape — `if (events.length >= maxEvents)`
 * as a `return` inside a closure here, a `continue` there, an inverted `if (length < max)` guard
 * somewhere else, eight sites in all. That is four chances to get the count wrong and four places
 * to change when the rule does. It owns the rule once instead.
 *
 * ── Why a tail is possible at all ─────────────────────────────────────────────────────────────
 *
 * Every adapter must report `total`, and a total is only knowable by looking at every record. So
 * the whole source is already walked on every read — a 53 MB codex rollout included — and stopping
 * early was never saving the I/O, only discarding what it had already paid for. Keeping the LAST
 * `maxEvents` instead of the first therefore costs one array shift per event beyond the cap and
 * nothing else.
 *
 * That matters because the head is the wrong end for the question usually being asked. A digest of
 * a linked session wants the recent work; before this, a session longer than the scan window showed
 * its MIDDLE, and the newest turns were unreachable by any surface we offered.
 *
 * ── `from` reaches what neither end does ──────────────────────────────────────────────────────
 *
 * Head and tail together still leave a hole. Measured on a real local history: 10 of 279 counted sessions
 * exceed the 2,000-event cap, and 14,189 events — 13.8% of all history here — sit beyond both a head
 * and a tail read of their own session. `from` starts the window at an ordinal instead of at zero, so
 * the middle is addressable by the same positions every surface already reports.
 *
 * ── `ordinal` is a position, not an index ─────────────────────────────────────────────────────
 *
 * It counts every eligible event the source offered, whether or not this window kept it. Ids are
 * derived from it (`to-agent-items.ts`) and range lines are reported from it, so a tail window
 * numbering its first kept event `0` would renumber the end of a session as though it were the
 * start. In head mode this is identical to the old dense counter — nothing is skipped before the
 * cap — which is why the change is invisible everywhere except at the tail.
 */

import type { TranscriptEvent } from '../../shared/contracts'
import type { TranscriptResult } from './types'

/** An event as an adapter builds it: everything except its position, which the window assigns. */
export type PendingEvent = Omit<TranscriptEvent, 'ordinal'>

export interface EventWindow {
  /**
   * Offer one event. Always counted toward `total`; kept only if the window has room, or — in tail
   * mode — by evicting the oldest event it holds.
   */
  emit(event: PendingEvent): void
  /** The events kept and the number offered. */
  result(): TranscriptResult
}

export function eventWindow(maxEvents: number, tail = false, from = 0): EventWindow {
  const cap = Math.max(1, maxEvents)
  const start = Math.max(0, Math.floor(from))
  const events: TranscriptEvent[] = []
  let total = 0
  return {
    emit(event) {
      const positioned = { ...event, ordinal: total }
      total += 1
      // Counted toward `total` either way — a total is the whole source, not the part asked for —
      // but never kept, so an offset is a window and not a filter that hides the size of the session.
      if (positioned.ordinal < start) return
      if (tail) {
        events.push(positioned)
        if (events.length > cap) events.shift()
        return
      }
      if (events.length < cap) events.push(positioned)
    },
    result() {
      return { events, total }
    },
  }
}
