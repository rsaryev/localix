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
  if (preferred) return [preferred]
  const at = listed.findIndex((item) => !options.held?.has(item.id))
  if (at < 0) return []
  const head = listed[at]!
  if (head.value.batch) return listed.filter((item) => item.value.batch === head.value.batch)
  const rule = batchRule(head.value)
  if (!rule) return [head]
  const band = [head]
  for (const item of listed.slice(at + 1)) {
    if (item.priority !== head.priority) break
    if (!item.value.batch && batchRule(item.value)?.key === rule.key) band.push(item)
    else if (rule.adjacent) break
  }
  return band
}

/**
 * WHO a delivered band is for, when its entries agree.
 *
 * A routed report names the participant it concerns, and a room shows it whole to that member
 * and as one line to the rest. Two reports about two different members merge into a turn that
 * is for NEITHER: narrowing it for one would hide the other's from the member it belongs to,
 * so a mixed band is addressed to nobody and everyone reads it in full.
 */
export function bandRecipient<T extends { participant: string; handle?: string }>(
  turns: readonly { to?: T }[],
): T | undefined {
  const named = turns.map((turn) => turn.to).filter((to) => to !== undefined)
  if (named.length === 0) return undefined
  return named.every((to) => to.participant === named[0]!.participant) ? named[0] : undefined
}
