/**
 * Which file / hunk header the sticky overlay pins for a scroll offset, and by how
 * much the NEXT header pushes it up.
 *
 * CSS `position: sticky` cannot do this in a virtualized list: the header row is
 * unmounted as soon as it leaves the render window, and a sticky element only sticks
 * inside its own mounted parent. So the overlay is a separate layer and this pure
 * function is its geometry — read from the layout's prefix sums, never the DOM.
 * The push (a negative translate) is what keeps the outgoing header from covering the
 * incoming one for the few pixels where both would occupy the pin slot.
 */
import { rowAt, type DiffLayout } from './diffRows'

export interface StickyHeader {
  id: number
  /** ≤ 0: how far the next header has pushed this one up. */
  shift: number
}

export interface DiffStickyState {
  file: StickyHeader | null
  hunk: StickyHeader | null
  /** 0-based position among `layout.hunkRows` for the "change n of m" indicator. */
  current: number
}

/** Index of the last element ≤ `value` in an ascending array, or -1. */
function lastAtOrBefore(sorted: readonly number[], value: number): number {
  let lo = 0
  let hi = sorted.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid]! <= value) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

export function diffStickyState(
  layout: DiffLayout,
  scrollTop: number,
  heights: { file: number; hunk: number },
  fileHeaders: boolean,
): DiffStickyState {
  const { offsets, fileRows, hunkRows } = layout
  const none: DiffStickyState = { file: null, hunk: null, current: 0 }
  if (layout.rows.length === 0) return none

  let file: StickyHeader | null = null
  const fileSlot = fileHeaders ? heights.file : 0
  if (fileHeaders) {
    const fileId = layout.fileOf[rowAt(layout, scrollTop)]!
    const headerRow = fileRows[fileId]!
    if (headerRow >= 0 && offsets[headerRow]! < scrollTop) {
      const next = fileRows[fileId + 1]
      const shift = next === undefined ? 0 : Math.min(0, offsets[next]! - scrollTop - heights.file)
      file = { id: fileId, shift }
    }
  }

  // The hunk pinned is the one covering the first line BELOW the file slot.
  const probe = rowAt(layout, scrollTop + fileSlot)
  const current = Math.max(0, lastAtOrBefore(hunkRows, probe))
  const hunkId = layout.hunkOf[probe]!
  const headerRow = hunkId >= 0 ? layout.hunkRowOf[hunkId]! : -1
  let hunk: StickyHeader | null = null
  if (headerRow >= 0 && offsets[headerRow]! < scrollTop + fileSlot) {
    const slotBottom = scrollTop + fileSlot + heights.hunk
    const nextHunk = hunkRows[lastAtOrBefore(hunkRows, headerRow) + 1]
    const nextFile = fileHeaders ? fileRows[layout.fileOf[headerRow]! + 1] : undefined
    const boundary = Math.min(
      nextHunk === undefined ? Infinity : offsets[nextHunk]!,
      nextFile === undefined ? Infinity : offsets[nextFile]!,
    )
    hunk = { id: hunkId, shift: Math.min(0, boundary - slotBottom) }
  }
  return { file, hunk, current }
}
