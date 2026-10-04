// The apply_patch ENGINE: locate each chunk in the file (through the tolerance
// ladder in patch-match.ts, plus the bounded unique-only repairs below) and
// produce the new file content. How the result is reported back lives in
// patch-report.ts.

import {
  findMatch,
  findUniqueMatch,
  reindentNewLines,
  buildNotFoundHint,
  buildRepairDiagnosis,
  describeStrategy,
  unescapeLiteral,
  type PatchMatch,
} from './patch-match'
import type { UpdateChunk } from './patch-parse'
import { buildToolError } from '../tool-errors'
import { plural } from '../tool-output'

export function trimTrailingPatchMetadata(patchText: string): string {
  return patchText.replace(/\n\\ No newline at end of file/g, '')
}

export function errorResult(
  message: string,
  kind: 'validation' | 'not_found' = 'validation',
  retryable = false,
) {
  return buildToolError({ message, kind, retryable })
}

// ---- Matching strategy ladder ----------------------------------------------
//
// Each line-based strategy below is a strict superset of the previous one, so
// the FIRST strategy that yields any candidates is also the LEAST tolerant one
// that can -- which is exactly the level at which ambiguity must be judged
// (see findUniqueMatch). The whitespace/indentation strategies form a replacer
// ladder; the Unicode normalizer applies NFKC + smart quotes/dashes/spaces.

/**
 * Unicode normalization for tolerant matching: NFKC plus smart quotes to ASCII,
 * Unicode dashes to '-', special spaces to ' ' -- a superset of the old punctuation table.
 */
function applyReplacements(
  lines: string[],
  replacements: Array<[number, number, string[]]>,
): string[] {
  const next = [...lines]
  for (const [start, deleteCount, newLines] of [...replacements].reverse()) {
    next.splice(start, deleteCount, ...newLines)
  }
  return next
}

function computeReplacements(
  originalLines: string[],
  filePath: string,
  chunks: UpdateChunk[],
  notes?: string[],
): Array<[number, number, string[]]> {
  const replacements: Array<[number, number, string[]]> = []
  let lineIndex = 0

  // A no-op chunk changes nothing — its before-image equals its after-image (the
  // model emitted byte-identical "-"/"+" lines). Weak models
  // interleave these as decorative/duplicate hunks. When the file also has a REAL
  // change, skip the no-ops: a pointless (and possibly unlocatable) no-op must never
  // fail the whole file. If EVERY chunk is a no-op, fall through to normal processing
  // so the existing behavior/error is preserved (never a silent fake success).
  const isNoop = (c: UpdateChunk) => c.oldLines.join('\n') === c.newLines.join('\n')
  const substantive = chunks.filter((c) => !isNoop(c))
  const effectiveChunks = substantive.length > 0 ? substantive : chunks
  if (notes && substantive.length > 0 && substantive.length < chunks.length) {
    const skipped = chunks.length - substantive.length
    notes.push(
      `note: skipped ${plural(skipped, 'no-op hunk')} in ${filePath} (removals identical to additions)`,
    )
  }

  for (const chunk of effectiveChunks) {
    let anchorFound = false
    if (chunk.changeContext) {
      // The @@ anchor is a hint, not a hard requirement: when the chunk carries
      // content, an unfound anchor falls through to content matching from the current
      // position instead of failing the whole patch (a common instability source).
      // block-anchor is excluded — a one-line pattern can't use it, and it is the one
      // strategy that would match a region of a different length.
      const contextIndex = findMatch(originalLines, [chunk.changeContext], lineIndex, false, true)
      if (contextIndex) {
        anchorFound = true
        lineIndex = contextIndex.index + 1
        if (!contextIndex.exact && notes) {
          notes.push(
            `note: the "@@ ${chunk.changeContext}" anchor matched with ${describeStrategy(contextIndex.strategy)} tolerance at line ${contextIndex.index + 1} in ${filePath} - verify the result`,
          )
        }
      }
    }

    if (chunk.oldLines.length === 0) {
      // A pure insertion has NO content to match, so the anchor is its ONLY locator.
      // Falling through with a stale `lineIndex` silently drops the lines at whatever
      // position the previous chunk happened to end at — for a first chunk, the very
      // top of the file. Fail loudly instead: the model meant somewhere specific.
      if (chunk.changeContext && !chunk.isEndOfFile && !anchorFound) {
        throw new Error(
          `apply_patch error: the "@@ ${chunk.changeContext}" anchor was not found in ${filePath}, and the hunk adds lines without any context to locate them.\n` +
            'Re-issue this hunk with an anchor that appears verbatim in the file, or with the unchanged lines immediately above and below the insertion point.' +
            buildWholeFileHint(originalLines),
        )
      }
      const insertionIndex =
        chunk.changeContext && !chunk.isEndOfFile ? lineIndex : originalLines.length
      // A "+"-only hunk with neither an anchor nor "*** End of File" has no locator at
      // all, so it lands at the end. Say so — the model may have meant somewhere else.
      if (!chunk.changeContext && !chunk.isEndOfFile && notes) {
        notes.push(
          `note: a hunk in ${filePath} adds lines with no context and no "@@" anchor, so it was appended at the end of the file - verify the result`,
        )
      }
      replacements.push([insertionIndex, 0, chunk.newLines])
      lineIndex = insertionIndex
      continue
    }

    let oldLines = chunk.oldLines
    let newLines = chunk.newLines
    // Every strategy EXCEPT block-anchor first. block-anchor matches a region of a
    // different length than the pattern, so letting it run before the repairs below
    // silently APPLIES a malformed hunk — a context line the model duplicated gets
    // written into the file instead of being repaired or reported.
    let match = findMatch(originalLines, oldLines, lineIndex, chunk.isEndOfFile, true)

    if (match === null && oldLines[oldLines.length - 1] === '') {
      oldLines = oldLines.slice(0, -1)
      if (newLines[newLines.length - 1] === '') newLines = newLines.slice(0, -1)
      match = findMatch(originalLines, oldLines, lineIndex, chunk.isEndOfFile, true)
    }

    // Escape fallback: if the context didn't match but the model over-escaped the
    // body (literal \" \' \t \\), unescape both old and new lines consistently and
    // retry. Keeps written output correct (newLines get the same fix).
    if (match === null && hasOverEscape(oldLines)) {
      const unescOld = oldLines.map(unescapeBody)
      const candidate = findMatch(originalLines, unescOld, lineIndex, chunk.isEndOfFile, true)
      if (candidate !== null) {
        oldLines = unescOld
        newLines = newLines.map(unescapeBody)
        match = candidate
      }
    }

    // Bounded, UNIQUE-only repair for two weak-model diff-construction mistakes
    // (a line repeated as both context and '-'; one file line split into several
    // patch fragments). Tried ONLY after every normal strategy failed, and applied
    // ONLY when the repaired block matches exactly one location — otherwise we fall
    // through to the loud not-found error below and never guess.
    if (match === null) {
      const repaired = repairUnmatchedChunk(originalLines, oldLines, newLines, lineIndex)
      if (repaired) {
        oldLines = repaired.oldLines
        newLines = repaired.newLines
        match = repaired.match
        if (notes) {
          notes.push(
            `note: repaired a malformed hunk in ${filePath} at line ${match.index + 1} (${repaired.kind}) - verify the result`,
          )
        }
      }
    }

    // Only now block-anchor: every deterministic repair above had its chance, so a
    // length-changing match here is a genuine near-miss, not a malformation we could
    // have fixed exactly.
    if (match === null) {
      match = findMatch(originalLines, oldLines, lineIndex, chunk.isEndOfFile)
    }

    // OUT-OF-FILE-ORDER hunk: chunks are applied positionally, so the search starts at
    // the previous chunk's end. A model that lists its hunks bottom-up (or simply out
    // of order) therefore gets "Failed to locate the context block" for a block that IS
    // in the file, just earlier — and reads that as "the file changed under me". Accept
    // it, but only on the same never-guess terms as the repairs: the block must match
    // exactly ONE place in the whole file, at its own length (so the length-changing
    // block-anchor strategy can't smuggle a malformed hunk through), and must not
    // overlap a region an earlier chunk already claimed.
    if (match === null && !chunk.isEndOfFile) {
      const unique = findUniqueMatch(originalLines, oldLines)
      if (
        unique.kind === 'match' &&
        unique.match.index < lineIndex &&
        unique.match.length === oldLines.length
      ) {
        const start = unique.match.index
        const end = start + unique.match.length
        const overlaps = replacements.some(([i, len]) => i < end && start < i + len)
        if (!overlaps) {
          match = unique.match
          if (notes) {
            notes.push(
              `note: a hunk in ${filePath} was out of file order — matched uniquely at line ${start + 1}`,
            )
          }
        }
      }
    }

    if (match === null) {
      // Actionable, retryable error: point at the closest region (and, for a small
      // file, the whole file with line numbers) so the model can fix context in ONE
      // shot without a re-read, plus a one-line diagnosis tuned to the failure shape.
      // The "don't re-read" advice is only honest when the error itself handed the
      // model the file. It does that for a small file (`buildWholeFileHint`); for a
      // large one it shows the closest REGION, which may not even contain the target.
      // A blanket ban then contradicts the tool's own "you never read this file, read
      // it first" diagnosis (added in patch.ts) and strands the model.
      const wholeFile = buildWholeFileHint(originalLines)
      const nearHint = buildNotFoundHint(originalLines, oldLines)
      const retryAdvice = wholeFile
        ? '\n\nCopy the context lines verbatim from the full file above — no re-read needed. Watch indentation/whitespace and retry with exact whole-line context.'
        : nearHint
          ? '\n\nThe "Actual lines" block above is the file\'s CURRENT content around the closest match — treat it as a fresh read. If the lines you meant to change appear there, copy them verbatim (watch indentation/whitespace) and retry your edit against this excerpt without re-reading the file. If they do not appear there, read the file and build the hunk from what it actually contains.'
          : '\n\nRead the file and build the hunk from what it actually contains.'
      throw new Error(
        `apply_patch error: Failed to locate the context block in ${filePath}.\nThe exact lines the patch requested to modify could not be found:\n` +
          oldLines.slice(0, 6).join('\n') +
          buildRepairDiagnosis(originalLines, oldLines) +
          nearHint +
          wholeFile +
          retryAdvice,
      )
    }

    // Non-exact strategies matched on normalized content -- reapply the file's
    // real indentation to inserted lines so the block lands correctly, and tell
    // the model which tolerance was needed so it can verify the result.
    if (!match.exact && notes) {
      notes.push(
        `note: context matched with ${describeStrategy(match.strategy)} tolerance at line ${match.index + 1} in ${filePath} - verify the result`,
      )
    }
    const finalNew = match.exact
      ? newLines
      : reindentNewLines(newLines, oldLines[0], originalLines[match.index] ?? '')
    replacements.push([match.index, match.length, finalNew])
    // Never walk the cursor backwards: an out-of-order hunk must not let a LATER chunk
    // re-match a region an earlier one already passed.
    lineIndex = Math.max(lineIndex, match.index + match.length)
  }

  replacements.sort((a, b) => a[0] - b[0])
  return replacements
}

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
function repairUnmatchedChunk(
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

/** For a small file, dump the whole thing with line numbers in the not-found error
 *  so the model can copy exact context without a re-read. Capped at 40 lines. */
function buildWholeFileHint(originalLines: string[]): string {
  if (originalLines.length === 0 || originalLines.length > 40) return ''
  return (
    `\n\nThe full file (${originalLines.length} lines) — copy context from here, verbatim:\n` +
    originalLines.map((l, i) => `${i + 1}\t${l}`).join('\n')
  )
}

export function applyUpdateChunks(
  originalContent: string,
  filePath: string,
  chunks: UpdateChunk[],
  notes?: string[],
): string {
  const originalLines = originalContent.split('\n')
  if (originalLines.length > 0 && originalLines[originalLines.length - 1] === '') {
    originalLines.pop()
  }

  let nextLines = applyReplacements(
    originalLines,
    computeReplacements(originalLines, filePath, chunks, notes),
  )
  if (nextLines.length === 0 || nextLines[nextLines.length - 1] !== '') {
    nextLines = [...nextLines, '']
  }
  return nextLines.join('\n')
}

/**
 * Undo over-escaping that some models emit in patch bodies (literal \" \' \t \\
 * where the file has the real character). Count-preserving — deliberately omits
 * \n so a single body line is never split into two (which would corrupt the
 * line-based matcher). Used only as a fallback when exact/trimmed matching fails.
 */
// Per-line unescape (newlines OFF so a body line is never split) — delegates to
// patch-match's unescapeLiteral, the one shared implementation.
function unescapeBody(s: string): string {
  return unescapeLiteral(s, false)
}

function hasOverEscape(lines: string[]): boolean {
  return lines.some((l) => /\\["'t\\]/.test(l))
}
