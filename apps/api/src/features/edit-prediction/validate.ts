/**
 * Structured-response VALIDATION — the Zod output contract plus the live-file
 * range/no-op/drift checks and the overlap-dedupe ordering. These are the correctness
 * guarantees that keep a hallucinated or stale hunk from ever reaching the editor;
 * `parse.ts` reads raw model text, this module decides what is a valid edit.
 *
 * Pure — no I/O, no clock. Lines are 1-based inclusive throughout.
 */

import { z } from 'zod'
import { CURSOR_MARKER, MAX_EDITS, type EditPrediction } from './contracts'

/**
 * The model's structured next-edit reply. ZOD is the explicit contract for the
 * JSON path: 1-based positive integer line numbers, `endLine >= startLine`, a
 * string `replacement`. `original` is OPTIONAL and advisory — the real drift
 * baseline is always re-sliced from the live file (`makeEdit`), never trusted from
 * the model. `safeParse` fails closed: bad line numbers, missing/mis-typed fields,
 * or a non-object all reject → the caller drops that hunk.
 */
export const nextEditReplySchema = z
  .object({
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    original: z.string().optional(),
    replacement: z.string(),
  })
  .refine((v) => v.endLine >= v.startLine, { message: 'endLine must be >= startLine' })

/** Slice the file's exact text across a 1-based inclusive line range. */
export function sliceLines(lines: string[], startLine: number, endLine: number): string {
  return lines.slice(startLine - 1, endLine).join('\n')
}

/** Build an EditPrediction from a validated 1-based range + replacement, or null.
 * The `original` (drift baseline) is ALWAYS re-sliced from the live file — a
 * model-supplied `original` is advisory only. Rejects an out-of-range span or a
 * no-op (replacement === original). */
/**
 * Why a hunk was refused. `makeEdit` collapsed three distinct causes into one `null`,
 * which made the interesting two unobservable: `out_of_range` means the model aimed at a
 * line the file does not have, and `no_op` means it proposed text identical to what is
 * already there. Both are MISLOCATION symptoms — the model knowing what to write but not
 * where — so their rate is the metric any change to how the cursor is conveyed has to
 * move. `non_integer_line` is a malformed reply, a different thing entirely.
 */
export type EditRejection = 'non_integer_line' | 'out_of_range' | 'no_op'

/**
 * Remove prompt scaffolding a reply echoed back. The prompt shows the file as `<n>\t<text>`
 * with {@link CURSOR_MARKER} inside the cursor line; neither belongs in a `replacement`, and
 * writing either one into the document corrupts it — silently, since a corrupted replacement
 * is still a well-formed hunk by every other check.
 *
 * Line numbers are stripped ALL-OR-NOTHING and only when each prefix equals the line number
 * that position would actually have. A file whose real content starts with digits and a tab
 * (TSV, fixtures) is then left alone, because its numbers would not form that exact run.
 */
export function stripPromptScaffolding(
  replacement: string,
  startLine: number,
): { text: string; stripped: boolean } {
  const withoutMarker = replacement.split(CURSOR_MARKER).join('')
  const lines = withoutMarker.split('\n')
  const numbered = lines.every((line, i) => {
    const match = /^(\d+)\t/.exec(line)
    return match !== null && Number(match[1]) === startLine + i
  })
  const text = numbered
    ? lines.map((line) => line.slice(line.indexOf('\t') + 1)).join('\n')
    : withoutMarker
  return { text, stripped: text !== replacement }
}

export function checkEdit(
  fileLines: string[],
  startLine: number,
  endLine: number,
  replacement: string,
): { ok: true; edit: EditPrediction; stripped: boolean } | { ok: false; rejection: EditRejection } {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    return { ok: false, rejection: 'non_integer_line' }
  }
  if (startLine < 1 || endLine < startLine || endLine > fileLines.length) {
    return { ok: false, rejection: 'out_of_range' }
  }
  // Strip BEFORE the no-op test: scaffolding is the difference in `"1\tfoo"` vs `"foo"`, so
  // comparing first would accept a hunk that changes nothing but the echoed prefix.
  const { text, stripped } = stripPromptScaffolding(replacement, startLine)
  const original = sliceLines(fileLines, startLine, endLine)
  if (text === original) return { ok: false, rejection: 'no_op' }
  return { ok: true, edit: { startLine, endLine, original, replacement: text }, stripped }
}

export function makeEdit(
  fileLines: string[],
  startLine: number,
  endLine: number,
  replacement: string,
): EditPrediction | null {
  const checked = checkEdit(fileLines, startLine, endLine, replacement)
  return checked.ok ? checked.edit : null
}

/**
 * Order survivors for the Tab cascade and drop conflicts: sort by `startLine` with
 * OVERLAPPING ranges dropped (first-listed wins — the model leads with its
 * most-confident hunk). Capped at `MAX_EDITS`.
 */
export function orderAndDedupeEdits(edits: EditPrediction[]): EditPrediction[] | null {
  const kept: EditPrediction[] = []
  for (const e of edits) {
    const overlaps = kept.some((k) => e.startLine <= k.endLine && e.endLine >= k.startLine)
    if (!overlaps) kept.push(e)
  }
  kept.sort((a, b) => a.startLine - b.startLine)
  const out = kept.slice(0, MAX_EDITS)
  return out.length > 0 ? out : null
}
