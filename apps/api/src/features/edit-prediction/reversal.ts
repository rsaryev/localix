/**
 * Reject a prediction that undoes the edit the user just made.
 *
 * A next-edit model sees the file as it is now plus the recent edit windows, and one of
 * its characteristic failure modes is to propose restoring the pre-edit text: the user
 * types, the model offers to type it back. Accepting costs the user their own work, and
 * because the hunk is well-formed — in range, anchored, non-empty, non-overlapping — every
 * existing validation gate passes it.
 *
 * Reversal is normally treated as an offline quality metric — score how much of a
 * prediction undoes the user's recent edits, over labelled examples. The same idea is
 * cheap to run LIVE here, because the recent edit windows are already part of every request.
 *
 * The rule here is deliberately the narrow, unambiguous case: the hunk's replacement
 * reproduces the recorded PRE-edit text of a window it overlaps. That is an exact revert
 * and needs no threshold. Partial or fuzzy overlap is left alone on purpose — this runs
 * on live predictions, and silently dropping a legitimate hunk is a worse failure than
 * letting a partial reversal through for the user to reject.
 */
import type { EditPrediction } from './contracts'

export interface RecentEditWindow {
  /** The window's text BEFORE the user's edit, when the client recorded it. */
  before?: string[]
  /** The window's text as it stands now. */
  lines: string[]
  startLine?: number
  endLine?: number
}

/** Compare ignoring trailing whitespace per line and leading/trailing blank lines. */
function normalizeBlock(lines: readonly string[]): string {
  return lines
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '')
}

function overlaps(edit: EditPrediction, window: RecentEditWindow): boolean {
  // A window without line bounds cannot be positioned, so it constrains nothing.
  if (
    typeof window.startLine !== 'number' ||
    typeof window.endLine !== 'number' ||
    !Number.isFinite(window.startLine) ||
    !Number.isFinite(window.endLine)
  ) {
    return false
  }
  return edit.startLine <= window.endLine && edit.endLine >= window.startLine
}

/**
 * True when this hunk restores the pre-edit text of a recent edit window it overlaps.
 *
 * Requires a recorded `before` that actually differs from the window's current text:
 * without it there is no evidence the user changed anything, and a window whose before
 * and after agree describes a no-op the user never made.
 */
export function reversesRecentEdit(
  edit: EditPrediction,
  recentEdits: readonly RecentEditWindow[],
): boolean {
  const replacement = normalizeBlock((edit.replacement ?? '').split('\n'))
  if (!replacement) return false
  for (const window of recentEdits) {
    if (!window.before?.length || !overlaps(edit, window)) continue
    const before = normalizeBlock(window.before)
    if (!before || before === normalizeBlock(window.lines)) continue
    if (replacement === before) return true
  }
  return false
}

/**
 * Drop every hunk that reverts a recent edit, preserving order.
 *
 * Returns null when nothing survives, matching the per-hunk fail-safe contract the rest
 * of the pipeline uses: an empty survivor set is "no prediction", never an empty edit.
 */
export function dropReversingEdits(
  edits: readonly EditPrediction[],
  recentEdits: readonly RecentEditWindow[],
): EditPrediction[] | null {
  if (recentEdits.length === 0) return edits.length > 0 ? [...edits] : null
  const kept = edits.filter((edit) => !reversesRecentEdit(edit, recentEdits))
  return kept.length > 0 ? kept : null
}
