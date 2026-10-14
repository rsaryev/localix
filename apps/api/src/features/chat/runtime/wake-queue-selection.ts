import type { QueueItem } from '../../../lib/priority-queue'

interface DrainSelectableTurn {
  bindings?: readonly unknown[]
  executionContext?: unknown
  toolSurface?: unknown
  extraDisabledTools?: readonly string[]
  to?: { participant: string }
  addressedAs?: string
  agentTurn?: unknown
  command?: unknown
}

/**
 * These inputs shape execution and cannot be inherited from a neighbouring turn. The person's
 * words a wake is addressed by (`addressedAs`) are one: they decide who answers, so a report
 * coalesced into that band would be routed by an address it never carried.
 */
export const hasExecutionOverrides = (turn: DrainSelectableTurn): boolean =>
  turn.executionContext != null ||
  turn.agentTurn != null ||
  turn.command != null ||
  turn.toolSurface != null ||
  turn.addressedAs !== undefined ||
  Boolean(turn.extraDisabledTools?.length)

interface SelectDrainBandOptions {
  /** Execute this exact row ahead of the normal priority/FIFO head. */
  preferredItemId?: string
  /** Durable delivery checkpoints one transcript pair per queue row. */
  durable: boolean
}

/**
 * Select one executable queue band without mutating the queue.
 *
 * Selection policy lives here so priority, durable replay, and binding isolation are one
 * independently testable decision rather than interleaved with I/O.
 */
export function selectDrainBand<T extends DrainSelectableTurn>(
  listed: readonly QueueItem<T>[],
  options: SelectDrainBandOptions,
): QueueItem<T>[] {
  if (listed.length === 0) return []
  const preferred = options.preferredItemId
    ? listed.find((item) => item.id === options.preferredItemId)
    : undefined
  const topPriority = preferred?.priority ?? listed[0]!.priority
  let selected = preferred ? [preferred] : listed.filter((item) => item.priority === topPriority)

  // A durable row has one stable transcript pair. Single-row bands make
  // insert→ack replay exact if a process dies while a lease is outstanding.
  if (options.durable) selected = selected.slice(0, 1)

  // Addressed and unaddressed turns have different audiences. Never erase that boundary
  // by coalescing, even when the test/in-memory host does not use durable checkpoints.
  const recipient = selected[0]?.value.to?.participant
  const recipientBoundary = selected.findIndex((item) => item.value.to?.participant !== recipient)
  if (recipientBoundary > 0) selected = selected.slice(0, recipientBoundary)

  // An explicit execution shape owns a separate run. Keep preceding text in FIFO order;
  // neither coalescing nor choosing a later bound row may cross this authority boundary.
  const executionIndex = selected.findIndex((item) => hasExecutionOverrides(item.value))
  if (executionIndex === 0) return [selected[0]!]
  if (executionIndex > 0) selected = selected.slice(0, executionIndex)

  // A turn with structured bindings owns the whole preamble and cannot be
  // coalesced with unrelated queue text.
  const bound = selected.find((item) => item.value.bindings?.length)
  return bound ? [bound] : selected
}

/**
 * WHO a coalesced band of queued turns is for, when they agree.
 *
 * A routed report names the participant it concerns, and a room shows it whole to that member
 * and as one line to the rest. Two reports about two different members merge into a turn that
 * is for NEITHER: narrowing it for one would hide the other's from the member it belongs to,
 * so a mixed band is addressed to nobody and everyone reads it in full, as before.
 */
export function bandRecipient<T extends { participant: string; handle?: string }>(
  turns: readonly { to?: T }[],
): T | undefined {
  const named = turns.map((turn) => turn.to).filter((to) => to !== undefined)
  if (named.length === 0) return undefined
  return named.every((to) => to.participant === named[0]!.participant) ? named[0] : undefined
}
