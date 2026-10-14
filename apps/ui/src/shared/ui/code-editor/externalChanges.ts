import { createTwoFilesPatch } from 'diff'
import { parseUnifiedDiff, type DirtyChange } from './dirtyDiffGutter'

/**
 * Which lines an external write changed in an open, clean buffer.
 *
 * When an agent edits a file the person has open, the editor adopts the new text in place.
 * Adopting it silently was the complaint: the text moved and nothing said where. The two
 * sides are both in hand at that moment, so the changed lines are computed once, with the
 * same unified-diff parser the git gutter uses (`parseUnifiedDiff`), in the NEW text's line
 * coordinates. Monaco decorations then track those lines through later edits; the editor
 * clears them when the person starts editing (`decorations.setExternalChanges`).
 */
export function externalLineChanges(before: string, after: string): DirtyChange[] {
  if (before === after) return []
  // Same trailing-newline normalization as the compare view: an EOF-only difference is not a
  // change anyone is looking for.
  const a = before.endsWith('\n') ? before : `${before}\n`
  const b = after.endsWith('\n') ? after : `${after}\n`
  return parseUnifiedDiff(createTwoFilesPatch('before', 'after', a, b, '', '', { context: 0 }))
}
