/**
 * Resolve the tool a transcript event belongs to.
 *
 * A result carries the call's ID and NOT its name — the adapters' convention, because the id is what
 * pairing is decided on and a name on the result would be a second copy free to disagree with the
 * call. Every renderer that shows a result therefore has to look the name up, and there are three of
 * them: the resource digest, the `transcript` tool action, and the item projection. This is the one
 * lookup they share, rather than the third copy of it.
 *
 * The name is looked up, never invented. An id with no call among the events keeps whatever the event
 * itself said, which for a bare result is nothing — and nothing is the honest answer, because the
 * alternative is borrowing the nearest tool's name.
 */

import type { TranscriptEvent } from '../../shared/contracts'

/** Tool name per call id, gathered from every event given — including ones a caller will not show. */
export function toolNamesByCallId(events: readonly TranscriptEvent[]): ReadonlyMap<string, string> {
  const names = new Map<string, string>()
  for (const event of events) {
    if (event.toolCallId && event.toolName) names.set(event.toolCallId, event.toolName)
  }
  return names
}

/** The tool this event is about: its own name, else the name of the call it reports. */
export function toolNameOf(
  event: TranscriptEvent,
  names: ReadonlyMap<string, string>,
): string | undefined {
  return event.toolName ?? (event.toolCallId ? names.get(event.toolCallId) : undefined)
}
