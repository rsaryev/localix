// Change-stat COUNTING is owned by the shared `@localixai/api/item-format` leaf, so the
// web card and any other renderer derive identical numbers from one implementation. The
// leaf speaks `{ added, removed }`; the web card's rendering speaks `{ additions, deletions }`.
// This module is the SINGLE boundary that adapts the leaf's vocabulary to the web's — every
// card counter flows through here, so no call site re-implements the counting or the rename.
import {
  countTextLines,
  countEditChanges as countEditChangesLeaf,
  countPatchChanges as countPatchChangesLeaf,
  type ChangeStats,
} from '@localixai/api/item-format'

/** The web card's change-stat vocabulary — the leaf's `{ added, removed }`, renamed. */
export interface WebChangeStats {
  additions: number
  deletions: number
}

const toWebStats = ({ added, removed }: ChangeStats): WebChangeStats => ({
  additions: added,
  deletions: removed,
})

/** Count lines in a (possibly partial) text payload. Empty → 0. */
export function countLines(text: string | undefined): number {
  return countTextLines(text)
}

/**
 * Approximate +/- line counts for a streaming edits array, in the web card's
 * `{ additions, deletions }` vocabulary. Partial mid-stream objects are tolerated.
 */
export function countEditChanges(edits: unknown): WebChangeStats {
  return toWebStats(countEditChangesLeaf(edits))
}

/** +/- counts from a (possibly partial) V4A/unified patch text, in the web card's vocabulary. */
export function countPatchChanges(patch: string | undefined): WebChangeStats {
  return toWebStats(countPatchChangesLeaf(patch))
}
