/**
 * The in-memory half of `edit`: one file's edits applied, in order, to its text.
 *
 * Claude Code's MultiEdit semantics: each edit matches against the text the previous edit left,
 * and the first edit that cannot match — missing or ambiguous — fails the WHOLE file. Nothing is
 * written for a failed file, so a half-applied file can never reach disk; the caller owns the I/O
 * and only writes when this returns `ok`.
 *
 * A no-op edit (`new_string` equal to `old_string`) is the exception: it is skipped and named.
 * It changes nothing, so skipping it cannot half-apply anything, and failing on it cost a whole
 * batch: gpt-6-luna repeated one unchanged span inside 7–8-edit batches eight times, and each
 * refusal discarded every real edit beside it. A file whose edits are ALL no-ops still fails.
 */
import { normalizeToLF } from './file-line-endings'
import type { FileMtimeStore } from './file-utils'

export interface EditStep {
  /** Position in the call's `edits` array — what a failure names. */
  index: number
  old_string: string
  new_string: string
  replace_all?: boolean
}

export type EditApplyResult =
  | { ok: true; text: string; replacements: number; lines: number[]; skipped: number[] }
  | { ok: false; message: string }

/** 1-based line numbers at which `needle` starts in `haystack`. */
function occurrenceLines(haystack: string, needle: string): number[] {
  const lines: number[] = []
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) return lines
    lines.push(haystack.slice(0, at).split('\n').length)
    from = at + needle.length
  }
}

/**
 * Why an exact match failed, in the terms the model can act on. Order matters: the
 * whitespace diagnosis is the common typo; the unread/edited-outside causes are the ones the
 * patch tool learned the hard way (13 of 65 recorded context failures were on unread files).
 */
function noMatchDiagnosis(
  text: string,
  oldString: string,
  path: string,
  mtimes: FileMtimeStore,
): string {
  const squash = (s: string) =>
    s
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .trim()
  if (squash(text).includes(squash(oldString))) {
    return ' The text exists but differs in indentation or spacing — copy it exactly as `Read` printed it.'
  }
  if (mtimes.wasInvalidated(path)) {
    return ` ${path} was modified outside this session after you last read it; read it again and rebuild \`old_string\` from the current content.`
  }
  if (!mtimes.has(path)) {
    return ` You have not read ${path} with \`Read\` in this session, so \`old_string\` came from memory. Read it first, then edit.`
  }
  return ' Re-read the region and copy the current text verbatim.'
}

/**
 * Apply `steps` to `original` (already BOM-stripped and LF-normalized). `labelled` prefixes each
 * failure with `edits[i]` — on for a call with several edits, off for a lone one so its message
 * reads as it always did.
 */
export function applyEditSteps(
  original: string,
  steps: readonly EditStep[],
  path: string,
  mtimes: FileMtimeStore,
  labelled: boolean,
): EditApplyResult {
  let text = original
  let replacements = 0
  const lines: number[] = []
  const skipped: number[] = []
  const isNoOp = (step: EditStep) =>
    normalizeToLF(step.old_string) === normalizeToLF(step.new_string)
  if (steps.every(isNoOp)) {
    const label = labelled ? `edits[${steps[0]!.index}]: ` : ''
    return {
      ok: false,
      message: `${label}\`new_string\` is identical to \`old_string\` — nothing to change.`,
    }
  }
  for (const [position, step] of steps.entries()) {
    const label = labelled ? `edits[${step.index}]: ` : ''
    const oldString = normalizeToLF(step.old_string)
    const newString = normalizeToLF(step.new_string)
    if (isNoOp(step)) {
      skipped.push(step.index)
      continue
    }
    const found = occurrenceLines(text, oldString)
    if (found.length === 0) {
      // The span was there before this call — an earlier edit in it consumed or rewrote it.
      const consumed =
        position > 0 && original.includes(oldString)
          ? ' An earlier edit in this call already changed that text: edits to one file apply in order, each to the result of the one before.'
          : noMatchDiagnosis(text, oldString, path, mtimes)
      return { ok: false, message: `${label}\`old_string\` was not found in ${path}.${consumed}` }
    }
    if (found.length > 1 && !step.replace_all) {
      return {
        ok: false,
        message:
          `${label}\`old_string\` occurs ${found.length} times in ${path} (lines ${found.join(', ')}). ` +
          'Include surrounding lines to make it unique, or pass `replace_all: true` to change every occurrence.',
      }
    }
    text = step.replace_all
      ? text.split(oldString).join(newString)
      : text.replace(oldString, () => newString)
    replacements += found.length
    lines.push(...found)
  }
  return { ok: true, text, replacements, lines, skipped }
}
