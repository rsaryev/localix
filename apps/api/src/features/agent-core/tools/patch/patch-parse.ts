// The parser orchestrates envelope recovery and per-file section parsing.
// Matching and applying the resulting hunks live in patch-match.ts and patch-apply.ts.
import {
  ADD_FILE,
  DELETE_FILE,
  FILE_HEADER_ALT,
  MOVE_TO,
  UPDATE_FILE,
  UPDATE_FILE_ALT,
  cleanHeaderPath,
  isNarrationLine,
} from './patch-syntax'
import { plural } from '../tool-output'
import { toEnvelopeLines } from './patch-envelope'
import { parseAddSection, parseMoveSection, parseUpdateSection } from './patch-sections'
import type { PatchHunk, ParseTolerances } from './patch-parse-contracts'

export type { PatchHunk, UpdateChunk } from './patch-parse-contracts'

/** The error shown when a line where a file section should start is not a file header. */
function invalidHeaderError(line: string, lineNo: number): Error {
  // A stray git/unified-diff header inside a patch that DOES carry file
  // directives. A patch made only of diff headers is normalized away upstream;
  // this one mixes the two dialects, so name the envelope it already chose.
  const looksLikeUnifiedDiff = /^(---\s|\+\+\+\s|diff --git|index [0-9a-f]+)/.test(line)
  return new Error(
    looksLikeUnifiedDiff
      ? `Line ${lineNo} ("${line}") is git/unified-diff syntax mixed into a "*** … File:" patch — use one dialect: ` +
          `"*** Begin Patch" / "*** Update File: <path>" / then " "-keep, "-"-remove, "+"-add lines (no ---/+++/@@/diff headers) / "*** End Patch".`
      : `Invalid patch hunk header at line ${lineNo} ("${line}"). Each file section starts with one of: ` +
          `"*** Add File: <path>", "*** Update File: <path>", "*** Delete File: <path>", or "*** Move to: <old> -> <new>". ` +
          `Inside an Update use " " keep / "-" remove / "+" add lines (optionally an "@@" anchor). You may include many files — and even multiple "*** Begin Patch"/"*** End Patch" blocks — in ONE call.`,
  )
}

export function parsePatchText(input: string, notes?: string[]): PatchHunk[] {
  const lines = toEnvelopeLines(input, notes)

  const hunks: PatchHunk[] = []
  const tolerances: ParseTolerances = { narrationSkipped: 0, emptyChunksSkipped: 0 }
  let index = 1

  while (index < lines.length - 1) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }
    // Decorative "***" narration the model interleaved at the top level (before the
    // first file directive, or after a completed file section) — skip it, don't try
    // to parse it as a directive.
    if (isNarrationLine(line)) {
      tolerances.narrationSkipped += 1
      index += 1
      continue
    }

    if (line.startsWith(ADD_FILE)) {
      const section = parseAddSection(lines, index, line)
      hunks.push(section.hunk)
      index = section.next
      continue
    }

    if (line.startsWith(DELETE_FILE)) {
      hunks.push({ kind: 'delete', path: cleanHeaderPath(line.slice(DELETE_FILE.length).trim()) })
      index += 1
      continue
    }

    if (line.startsWith(MOVE_TO)) {
      const moved = parseMoveSection(lines, index, line, notes)
      if ('reparse' in moved) return parsePatchText(moved.reparse, notes)
      hunks.push(moved.hunk)
      index = moved.next
      continue
    }

    const isUpdateFile =
      line.startsWith(UPDATE_FILE) ||
      line.startsWith(UPDATE_FILE_ALT) ||
      line.startsWith(FILE_HEADER_ALT)
    if (!isUpdateFile) throw invalidHeaderError(line, index + 1)

    const section = parseUpdateSection(lines, index, line, tolerances)
    hunks.push(section.hunk)
    index = section.next
  }

  if (hunks.length === 0) {
    throw new Error('Patch does not contain any hunks')
  }

  if (tolerances.narrationSkipped > 0 && notes) {
    const n = tolerances.narrationSkipped
    notes.push(`note: ignored ${plural(n, 'decorative "***" narration line')}`)
  }
  if (tolerances.emptyChunksSkipped > 0 && notes) {
    const n = tolerances.emptyChunksSkipped
    notes.push(`note: ignored ${plural(n, 'body-less "@@" anchor')}`)
  }

  return hunks
}
