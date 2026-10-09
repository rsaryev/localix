// Bounded repairs for malformed hunks; accept only an unambiguous file location.
import { findMatch, findUniqueMatch, type PatchMatch } from './patch-match'

const REPAIR_DEDUP = 'removed a line duplicated as both context and "-"'
const REPAIR_REJOIN = 'rejoined a line split into fragments'

interface ChunkRepair {
  oldLines: string[]
  newLines: string[]
  match: PatchMatch
  kind: typeof REPAIR_DEDUP | typeof REPAIR_REJOIN
}

/**
 * Accept a de-duplicated candidate chunk — but ONLY when it lands on exactly one
 * place in the file.
 *
 * This is the acceptance rule the three dedup repairs below share, and it is the
 * whole safety story of this module: a repair rewrites the model's patch, so it may
 * only be taken when there is no choice to get wrong. `findMatch` locating a
 * candidate is not enough — it returns the FIRST match — so `uniquelyMatches` must
 * also confirm there is no second one. Spelled out at each call site (three times,
 * including `findMatch`'s positional flags) it was three chances to drop the
 * uniqueness half and silently start guessing.
 *
 * Returns null when the candidate does not match, or matches more than once.
 */
function acceptDedup(
  originalLines: string[],
  dedupOld: string[],
  dedupNew: string[],
  start: number,
): ChunkRepair | null {
  const match = findMatch(originalLines, dedupOld, start, false, true)
  if (!match || !uniquelyMatches(originalLines, dedupOld)) return null
  return { oldLines: dedupOld, newLines: dedupNew, match, kind: REPAIR_DEDUP }
}

/**
 * Last-resort, UNIQUE-only repair for two common weak-model diff mistakes. Returns
 * a fixed chunk only when the result is UNAMBIGUOUS; an ambiguous or unclear case
 * returns null so the caller fails loudly. Never guesses.
 *
 *  1. Phantom anchor (dedup): the model repeated a line as BOTH a context line and
 *     an adjacent '-' removal, so oldLines has two identical neighbours that don't
 *     exist consecutively in the file. Dropping the duplicated leading/trailing
 *     context line (from old AND new) makes the block match uniquely.
 *  2. Fragmented line: the model split ONE file line into several patch lines
 *     across context/'-'/'+'. Joining the chunk's oldLines into a single line that
 *     equals exactly one file line, and replacing it with the joined newLines,
 *     restores the intended whole-line edit.
 */
export function repairUnmatchedChunk(
  originalLines: string[],
  oldLines: string[],
  newLines: string[],
  start: number,
): ChunkRepair | null {
  // (1) Drop a leading context line duplicated as the next '-' removal.
  if (
    oldLines.length >= 2 &&
    oldLines[0] === oldLines[1] &&
    newLines.length >= 1 &&
    newLines[0] === oldLines[0]
  ) {
    const repair = acceptDedup(originalLines, oldLines.slice(1), newLines.slice(1), start)
    if (repair) return repair
  }
  // (1b) Symmetric: a trailing context line duplicated as the preceding '-'.
  const n = oldLines.length
  if (
    n >= 2 &&
    oldLines[n - 1] === oldLines[n - 2] &&
    newLines.length >= 1 &&
    newLines[newLines.length - 1] === oldLines[n - 1]
  ) {
    const repair = acceptDedup(originalLines, oldLines.slice(0, -1), newLines.slice(0, -1), start)
    if (repair) return repair
  }

  // (1c) INTERIOR duplicate: two changes fell within a few lines of each other and
  // the model wrote the shared context line twice — once as change A's trailing
  // context, once as change B's leading context. It appears duplicated in BOTH old
  // and new (unlike (1)/(1b), where the duplicate is a "-" removal at an edge).
  // Measured on the recorded corpus this is the most common malformation: 22
  // occurrences, 14 of them in calls that failed. Dropping one copy from each side
  // is accepted ONLY when the result matches exactly one location.
  for (let i = 1; i < n; i += 1) {
    if (oldLines[i] !== oldLines[i - 1] || !oldLines[i].trim()) continue
    const j = newLines.findIndex(
      (line, k) => k > 0 && line === newLines[k - 1] && line === oldLines[i],
    )
    if (j < 0) continue
    const dedupOld = [...oldLines.slice(0, i), ...oldLines.slice(i + 1)]
    const dedupNew = [...newLines.slice(0, j), ...newLines.slice(j + 1)]
    const repair = acceptDedup(originalLines, dedupOld, dedupNew, start)
    if (repair) return repair
  }

  // (2) Rejoin a single file line the model split into fragments. Only when the
  // joined oldLines equal EXACTLY ONE whole file line (unique), so we never guess.
  if (oldLines.length >= 2 && newLines.length >= 1) {
    const joinedOld = [oldLines.join(' ')]
    const joinedNew = [newLines.join(' ')]
    const match = findMatch(originalLines, joinedOld, start, false, true)
    if (match?.length === 1 && uniquelyMatches(originalLines, joinedOld)) {
      return { oldLines: joinedOld, newLines: joinedNew, match, kind: REPAIR_REJOIN }
    }
  }
  return null
}

/** True when `pattern` matches exactly one location in the file (any tolerance). */
function uniquelyMatches(originalLines: string[], pattern: string[]): boolean {
  return findUniqueMatch(originalLines, pattern).kind === 'match'
}
