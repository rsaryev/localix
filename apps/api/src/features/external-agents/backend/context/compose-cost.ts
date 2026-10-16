import type { TranscriptEvent } from '../../shared/contracts'

/** No single event may eat a whole section's share. */
export const MAX_EVENT_CHARS = 4_000

/**
 * Planning and packing MUST cost an event identically. They used to differ by one character — the
 * ellipsis added when clipping — which made a section's whole allocation one short of its single
 * oversized event, so that event was dropped entirely instead of being included clipped.
 */
export const PER_EVENT_OVERHEAD = 24

export function clipEvent(text: string): string {
  return text.length > MAX_EVENT_CHARS ? `${text.slice(0, MAX_EVENT_CHARS)}…` : text
}

export function costOf(text: string): number {
  return text.length + PER_EVENT_OVERHEAD
}

export function totalChars(events: readonly TranscriptEvent[]): number {
  let sum = 0
  for (const event of events) sum += costOf(clipEvent(event.text))
  return sum
}
