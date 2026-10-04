/**
 * Pure turn-navigation helper for the chat transcript.
 *
 * Given the indices of the user-prompt rows (ascending) and the index of the
 * row currently anchored at the top of the viewport, returns the row to jump to
 * when the user asks for the previous / next prompt — or `null` when there is
 * none in that direction (so the caller can no-op instead of wrapping). Kept
 * pure so it's cheap and unit-testable.
 */
export type TranscriptNavDir = 'prev' | 'next'

export function nextPromptIndex(
  userIndices: readonly number[],
  anchorIndex: number,
  dir: TranscriptNavDir,
): number | null {
  if (dir === 'next') {
    for (const i of userIndices) {
      if (i > anchorIndex) return i
    }
    return null
  }
  // prev: the last user prompt strictly above the anchor.
  for (let k = userIndices.length - 1; k >= 0; k -= 1) {
    const i = userIndices[k]!
    if (i < anchorIndex) return i
  }
  return null
}
