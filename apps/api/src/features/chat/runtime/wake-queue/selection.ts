/**
 * WHICH ENTRIES THE NEXT DELIVERY TAKES — pure, without touching the queue.
 *
 * The head is the first entry in queue order (priority, then FIFO) that is not held
 * (`holds.ts`). It is delivered with the entries of its batch (`kinds.ts`): every report to the
 * same delegator, every event of the same stream, an unbroken run of the person's messages to the
 * same addressees. Everything else is delivered alone. A band claimed once before keeps exactly
 * its entries (`batch`), so a delivery a crash interrupted replays as it was.
 *
 * The same rules hold with and without a durable store. They did not: an in-memory queue merged
 * every same-priority neighbour and a durable one merged nothing, so the tests exercised a
 * coalescing production never did, and production answered each of three reports separately.
 */
import type { QueueItem } from '../../../../lib/priority-queue'
import type { PendingTurn } from './entry'
import { batchRule } from './kinds'

interface SelectDrainBandOptions {
  /** Execute this exact row ahead of the normal priority/FIFO head (send-now). */
  preferredItemId?: string
  /** Entries that may not open a turn yet. */
  held?: ReadonlySet<string>
}

export function selectDrainBand(
  listed: readonly QueueItem<PendingTurn>[],
  options: SelectDrainBandOptions = {},
): QueueItem<PendingTurn>[] {
  const preferred = options.preferredItemId
    ? listed.find((item) => item.id === options.preferredItemId)
    : undefined
  // A preferred entry claimed in a batch before is delivered with its batch, never alone: the
  // batch's transcript ids are its name's, and the rest would be acknowledged unsaid.
  const sticky = (head: QueueItem<PendingTurn>) =>
    head.value.batch ? listed.filter((item) => item.value.batch === head.value.batch) : undefined
  if (preferred) return sticky(preferred) ?? [preferred]
  // A failed entry (`dead-letter.ts`) waits for the person, not for the next drain.
  const at = listed.findIndex((item) => !options.held?.has(item.id) && !item.value.failure)
  if (at < 0) return []
  const head = listed[at]!
  const batch = sticky(head)
  if (batch) return batch
  const rule = batchRule(head.value)
  if (!rule) return [head]
  const band = [head]
  for (const item of listed.slice(at + 1)) {
    if (item.priority !== head.priority) break
    if (!item.value.batch && !item.value.failure && batchRule(item.value)?.key === rule.key)
      band.push(item)
    else if (rule.adjacent) break
  }
  return band
}
