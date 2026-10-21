import type { Message } from '../../model/types'

export interface MinimapTick {
  /** Row index in the PROJECTED transcript — the virtualizer's coordinate space,
   *  so a tick can be turned into an offset / scrollToIndex target directly. */
  index: number
  id: string
  excerpt: string
}

/** Below this the rail is noise, not navigation. */
export const MINIMAP_MIN_MESSAGES = 4

// The card clamps to ~3 lines; anything past this can never be visible.
const EXCERPT_MAX_CHARS = 200

export function messageExcerpt(content: string | undefined): string {
  if (!content) return ''
  return content.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_MAX_CHARS)
}

/**
 * One tick per USER message — the rail is a map of what you asked, which is what
 * anyone scrolls back to find. Assistant replies, system notices, command output
 * and uiOnly separators are all skipped: an answer is found by the question above
 * it, and ticking everything turned the rail into a dense stripe of noise.
 */
export function buildMinimapTicks(rows: readonly Message[]): MinimapTick[] {
  const ticks: MinimapTick[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    if (row.role !== 'user' || row.uiOnly) continue
    ticks.push({ index, id: row.id, excerpt: messageExcerpt(row.content) })
  }
  return ticks
}

/**
 * The tick "nearest the viewport": the last message whose top is at or above
 * the reading line (a third down the viewport, where the eye rests — the exact
 * top edge would flip the marker while a tall message still fills the screen).
 */
export function currentTickAt(
  offsets: readonly number[],
  scrollTop: number,
  viewportHeight: number,
): number {
  const readingLine = scrollTop + viewportHeight / 3
  let current = 0
  for (let i = 0; i < offsets.length; i += 1) {
    if (offsets[i]! <= readingLine) current = i
    else break
  }
  return current
}
