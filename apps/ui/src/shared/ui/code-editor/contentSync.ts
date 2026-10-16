/**
 * The two pure pieces of the editor's per-keystroke change path, kept out of
 * {@link CodeEditor} so they can be unit-tested without mounting Monaco:
 *
 * - `toEditorContentChanges` / `primaryChangeLine` — read the DELTAS a change event
 *   already carries, so a consumer that only needs to know WHAT changed never asks
 *   the model for the whole document again.
 * - `modelHoldsValue` — the echo guard that decides whether an incoming `value` prop
 *   is already in the model (our own edit coming back through React state) or is a
 *   genuine external update that must be pushed into it.
 */

import type { EditorContentChange } from './types'

/** The subset of Monaco's `IModelContentChange` this layer depends on (1-based lines). */
export interface MonacoContentChange {
  range: { startLineNumber: number; endLineNumber: number }
  text: string
}

/** Map Monaco's 1-based change list onto the editor-agnostic 0-based one. */
export function toEditorContentChanges(
  changes: readonly MonacoContentChange[],
): EditorContentChange[] {
  return changes.map((change) => ({
    startLine: change.range.startLineNumber - 1,
    endLine: change.range.endLineNumber - 1,
    text: change.text,
  }))
}

/**
 * The 0-based line a change event should be attributed to: the FIRST edited line in
 * document order. `null` when the event carries no changes (nothing to attribute).
 *
 * A multi-cursor edit reports several changes in ONE event and Monaco is free to order
 * them however it applies them (it reports them bottom-up), so taking the minimum keeps
 * the answer the same no matter the order — and for the ordinary single change it is
 * simply that change's line.
 */
export function primaryChangeLine(
  changes: readonly EditorContentChange[] | undefined,
): number | null {
  if (!changes || changes.length === 0) return null
  let line = changes[0].startLine
  for (const change of changes) if (change.startLine < line) line = change.startLine
  return line
}

/**
 * Does the model already hold exactly `value`?
 *
 * `mirror` is the editor's record of the model's exact text, or `null` when that record
 * cannot be trusted — then, and only then, the model is read in full. The answer is
 * IDENTICAL to always reading the model, as long as the mirror is only ever set to text
 * the model provably holds; it just avoids materializing the document on the common
 * path, where `value` is the very string the model handed out a moment ago.
 */
export function modelHoldsValue(mirror: string | null, value: string, read: () => string): boolean {
  return (mirror ?? read()) === value
}

/** The one contiguous span that turns `before` into `after` (offsets into `before`). */
export interface TextReplacement {
  start: number
  end: number
  text: string
}

/**
 * The smallest single replacement between two texts: everything outside their common
 * prefix and suffix. An external update (an agent's edit reloaded into a clean buffer, a
 * save's formatting) pushed in as a whole new value reset the caret to the top and wiped
 * undo; replacing only the span that differs keeps the caret where the person was, keeps
 * the rest of the document's markers, and is one undoable step. Null when nothing differs.
 */
export function minimalReplacement(before: string, after: string): TextReplacement | null {
  if (before === after) return null
  const max = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++
  // Never split a surrogate pair or a CRLF: step back onto a boundary both sides share.
  if (prefix > 0 && isSplitPoint(before, prefix)) prefix--
  let suffix = 0
  const suffixMax = max - prefix
  while (
    suffix < suffixMax &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  )
    suffix++
  if (suffix > 0 && isSplitPoint(before, before.length - suffix)) suffix--
  return {
    start: prefix,
    end: before.length - suffix,
    text: after.slice(prefix, after.length - suffix),
  }
}

/** Whether `offset` falls inside a surrogate pair or between `\r` and `\n`. */
function isSplitPoint(text: string, offset: number): boolean {
  const previous = text.charCodeAt(offset - 1)
  const next = text.charCodeAt(offset)
  return (
    (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) ||
    (previous === 13 && next === 10)
  )
}
