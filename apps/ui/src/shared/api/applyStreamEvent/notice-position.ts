import type { UiSession } from '../contracts'

/** Freeze the live item's boundary before subsequent deltas grow the same reply. */
export function noticePosition(
  session: UiSession,
  anchor: UiSession['messages'][number] | undefined,
) {
  if (anchor?.role !== 'assistant' || !session.isRunning) return undefined
  const item = anchor.items?.at(-1)
  if (item) {
    return {
      itemId: item.id,
      ...('text' in item && typeof item.text === 'string' ? { textOffset: item.text.length } : {}),
    }
  }
  return { contentOffset: anchor.content?.length ?? 0 }
}
