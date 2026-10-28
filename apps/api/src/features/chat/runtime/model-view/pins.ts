/**
 * PINNED, BUT OUT OF VIEW: the pinned messages the checkpoint in force does not show whole.
 *
 * A checkpoint freezes the view, so a pin placed after it cannot pull an evicted message back
 * into the history without rewriting it — the edit the whole design exists to avoid. Instead the
 * pinned text is carried in the turn's runtime context, a `state` section: sent when the set of
 * such pins changes, gone again once the next checkpoint places them in its head, where pins are
 * kept verbatim for good.
 */
import { truncateMiddle, type ContextCheckpoint } from '@localixai/agent'

import type { RuntimeSection } from '../../../agent-core/prompt/runtime-sections'
import type { PersistedMessage } from '../../contracts'

/** One pinned message may take this much of the context; the rest is one recall away. */
const PIN_MAX_CHARS = 4000

function messageText(row: PersistedMessage): string {
  const { payload } = row
  if (payload.role === 'user') return typeof payload.content === 'string' ? payload.content : ''
  const texts = (payload.items ?? []).flatMap((item) => (item.type === 'text' ? [item.text] : []))
  return texts.length > 0 ? texts.join('\n\n') : (payload.content ?? '')
}

/** Whose words a pin carries, from the agent's side: the person's or its own. */
function pinnedWho(row: PersistedMessage): string {
  return row.payload.role === 'user' ? 'said to you' : 'your reply'
}

export function pinnedOutOfViewSection(
  rows: readonly PersistedMessage[],
  checkpoint: ContextCheckpoint | undefined,
): RuntimeSection | undefined {
  if (!checkpoint) return undefined
  const cut = checkpoint.evictedThroughId
    ? rows.findIndex((row) => row.id === checkpoint.evictedThroughId)
    : 0
  const inHead = new Set(checkpoint.pinnedIds)
  const pins = rows.filter((row, index) => {
    if (row.payload.pinned !== true || inHead.has(row.id)) return false
    const evicted = index > 0 && index <= cut
    // Masked or folded. A collapsed stale snapshot alone does not count: the pin is about what
    // was said, and the snapshot is superseded by a newer one still in view.
    return evicted || checkpoint.transforms[row.id]?.op !== undefined
  })
  if (pins.length === 0) return undefined
  return {
    key: 'pinned',
    scope: 'state',
    text: [
      '# Pinned messages',
      'The person pinned these messages to keep them in your view; the conversation above shows them only in part:',
      ...pins.map(
        (row) =>
          `- ${row.id} (${pinnedWho(row)}): ` +
          truncateMiddle(messageText(row).trim(), { maxChars: PIN_MAX_CHARS }),
      ),
    ].join('\n'),
  }
}
