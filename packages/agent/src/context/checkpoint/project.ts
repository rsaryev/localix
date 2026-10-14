/**
 * `projectCheckpoint` — the model's view of a history under the checkpoint in force.
 *
 * A pure function of the log and one frozen record, and that is its whole contract: the next
 * turn must rebuild the view this turn was sent, byte for byte, or the provider's prefix cache
 * and the model's thinking chain break at the first byte that differs. So nothing here plans,
 * measures or consults anything the record did not freeze — it only applies.
 *
 * Layout, in reading order: the first task, the cards for everything evicted, the pinned
 * evicted messages, then the kept stretch — transformed as frozen, thinking stripped up to the
 * checkpoint — and finally everything newer than the checkpoint, untouched.
 */
import type { ChatMessage } from '../../chat'
import { renderCardsRegion } from './epoch-card'
import { applyFrozenTransform, stripReasoning } from './transforms'
import type { CheckpointEntry, ContextCheckpoint } from './types'

export interface ProjectCheckpointOptions<M extends ChatMessage> {
  /** The host's row for the card region: an internal message with an id stable per checkpoint. */
  cardsMessage: (text: string) => M
}

/**
 * Whether `checkpoint` describes THIS history. A checkpoint taken on another branch, or whose
 * messages were rolled back, is not a view of it — applying it anyway would evict the wrong
 * turns, so the history is shown whole and the next admission decides afresh.
 */
function anchoredIndices(
  entries: readonly CheckpointEntry[],
  checkpoint: ContextCheckpoint,
): { covered: number; evictEnd: number } | undefined {
  const covered = entries.findIndex((entry) => entry.message.id === checkpoint.coversThroughId)
  if (covered < 0) return undefined
  if (!checkpoint.evictedThroughId) return { covered, evictEnd: 0 }
  const evictEnd = entries.findIndex((entry) => entry.message.id === checkpoint.evictedThroughId)
  return evictEnd > 0 && evictEnd <= covered ? { covered, evictEnd } : undefined
}

export function projectCheckpoint<M extends ChatMessage>(
  entries: readonly CheckpointEntry<M>[],
  checkpoint: ContextCheckpoint | undefined,
  options: ProjectCheckpointOptions<M>,
): M[] {
  const anchored = checkpoint ? anchoredIndices(entries, checkpoint) : undefined
  if (!checkpoint || !anchored) return entries.map((entry) => entry.message)
  const flags = {
    recoveryToolAvailable: checkpoint.recoveryToolAvailable,
    recallToolAvailable: checkpoint.recallToolAvailable,
  }
  const shown = (index: number): M => {
    const { message } = entries[index]!
    if (index > anchored.covered) return message
    return applyFrozenTransform(stripReasoning(message), checkpoint.transforms[message.id], flags)
  }

  const view: M[] = [shown(0)]
  if (checkpoint.cards.length > 0) {
    view.push(options.cardsMessage(renderCardsRegion(checkpoint.cards, flags.recallToolAvailable)))
  }
  const pinned = new Set(checkpoint.pinnedIds)
  for (let i = 1; i <= anchored.evictEnd; i++) {
    if (pinned.has(entries[i]!.message.id)) view.push(stripReasoning(entries[i]!.message))
  }
  for (let i = anchored.evictEnd + 1; i < entries.length; i++) view.push(shown(i))
  return view
}
